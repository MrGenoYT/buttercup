/********************************************************************
 * BUTTERCUP
 * DISCORD BOT - ULTRA CODE: IMPORTS, ENVIRONMENT SETUP & MONGODB CONNECTION
 ********************************************************************/
import {
  Client, GatewayIntentBits, Partials, REST, Routes,
  ActionRowBuilder, StringSelectMenuBuilder, SlashCommandBuilder,
  ChannelType, PermissionsBitField, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TENOR_API_KEY = process.env.TENOR_API_KEY;
const PORT = process.env.PORT || 3000;
const MONGO_DB_PASSWORD = process.env.MONGO_DB_PASSWORD;
const MONGO_URI = `mongodb+srv://ankittsu2:${MONGO_DB_PASSWORD}@cluster0.6grcc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const MONGO_DB_NAME = "discord_bot";

// Global toggles and state variables
let globalChatEnabled = true;
let globalCustomMood = { enabled: false, mood: null };
const conversationTracker = new Map(); // key: channelId, value: { count, participants }
const userContinuousReply = new Map(); // per-user continuous reply setting
const lastActiveChannel = new Map(); // last active channel per guild
let autoReplyTriggered = new Map(); // to ensure auto-reply works only once per idle period

/********************************************************************
 * ADVANCED ERROR HANDLER
 ********************************************************************/
function advancedErrorHandler(error, context = "General") {
  const timestamp = new Date().toISOString();
  const errorMsg = `[${timestamp}] [${context}] ${error.stack || error}\n`;
  console.error(errorMsg);
  fs.appendFile("error.log", errorMsg, (err) => {
    if (err) console.error("Failed to write to error.log:", err);
  });
}
process.on("uncaughtException", (error) => {
  advancedErrorHandler(error, "Uncaught Exception");
});
process.on("unhandledRejection", (reason) => {
  advancedErrorHandler(reason, "Unhandled Rejection");
});

/********************************************************************
 * MONGODB DATABASE SETUP & HELPER FUNCTIONS
 ********************************************************************/
let db;
let mongoClient;
async function connectToDatabase() {
  try {
    mongoClient = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);
    console.log("✅ Connected to MongoDB database.");
    // Ensure indexes if necessary (for example, unique guild_id, user_id, etc.)
  } catch (error) {
    advancedErrorHandler(error, "MongoDB Connection");
  }
}
connectToDatabase();

// Helper functions for MongoDB operations
async function dbFind(collectionName, filter = {}, options = {}) {
  try {
    return await db.collection(collectionName).find(filter, options).toArray();
  } catch (error) {
    advancedErrorHandler(error, `dbFind in ${collectionName}`);
    return [];
  }
}
async function dbFindOne(collectionName, filter = {}, options = {}) {
  try {
    return await db.collection(collectionName).findOne(filter, options);
  } catch (error) {
    advancedErrorHandler(error, `dbFindOne in ${collectionName}`);
    return null;
  }
}
async function dbInsert(collectionName, doc) {
  try {
    return await db.collection(collectionName).insertOne(doc);
  } catch (error) {
    advancedErrorHandler(error, `dbInsert in ${collectionName}`);
  }
}
async function dbUpdate(collectionName, filter, update, options = {}) {
  try {
    return await db.collection(collectionName).updateOne(filter, update, options);
  } catch (error) {
    advancedErrorHandler(error, `dbUpdate in ${collectionName}`);
  }
}
async function dbDelete(collectionName, filter) {
  try {
    return await db.collection(collectionName).deleteMany(filter);
  } catch (error) {
    advancedErrorHandler(error, `dbDelete in ${collectionName}`);
  }
}

/********************************************************************
 * BOT CONFIGURATION, MOOD & BASE BEHAVIOUR (Updated Profile)
 ********************************************************************/
// Bot “persona” instructions – note the changes below.
const moodPresetReplies = {
  "base mood": "chill and calm, like a midnight drive.",
  "roasting": "bring on the heat – you're about to get roasted.",
  "neutral": "just chillin', no drama here.",
  "happy": "vibes on max, feeling ecstatic.",
  "sad": "in the mood, but still vibing.",
  "romantic": "love is in the air, smooth and tender.",
  "rizz": "dripping with rizz, nobody is safe",
  "villain arc": "embrace your dark side, let chaos reign.",
  "chill guy": "laid-back and cool, just cruising through."
};
const moodInstructions = {
  "base mood": `1. Stay smooth and calm.
2. Keep responses relaxed.
3. Avoid unnecessary drama.
4. Focus on clear info.
5. Use a casual tone.
6. Be friendly.
7. Maintain a mellow vibe.
8. Provide concise responses.
9. Remain objective.
10. Keep it effortlessly cool.`,
  "roasting": `1. Bring intense heat.
2. Deliver savage burns.
3. Use creative insults.
4. Stay edgy.
5. Incorporate witty comebacks.
6. Use sharp language.
7. Roast precisely.
8. Use modern slang.
9. Be brutally honest.
10. Leave no one unscathed.`,
  "neutral": `1. Stay balanced.
2. Keep tone even.
3. Provide factual info.
4. Avoid extremes.
5. Use clear language.
6. Remain impartial.
7. Keep it straightforward.
8. Use calm phrasing.
9. Stay neutral.
10. Avoid bias.`,
  "happy": `1. Exude high energy.
2. Use joyful language.
3. Keep tone upbeat.
4. Spread positive vibes.
5. Use playful expressions.
6. Smile in your words.
7. Keep it light.
8. Spread good cheer.
9. Be enthusiastic.
10. Radiate optimism.`,
  "sad": `1. Reflect gentle melancholy.
2. Use introspective language.
3. Express subdued emotion.
4. Keep tone soft.
5. Show empathy.
6. Be sincere.
7. Use reflective words.
8. Maintain a slow pace.
9. Stay subdued.
10. Convey heartfelt feelings.`,
  "romantic": `1. Speak with poetic flair.
2. Use tender language.
3. Keep tone alluring.
4. Evoke passion.
5. Use evocative imagery.
6. Be smooth and gentle.
7. Express admiration.
8. Use creative metaphors.
9. Radiate warmth.
10. Make it intimate.`,
  "rizz": `1. Exude modern charisma.
2. Use confident language.
3. Employ catchy slang.
4. Drop smooth pick-up lines.
5. Be bold and trendy.
6. Keep it street-smart.
7. Radiate charm.
8. Deliver pick-up lines.
9. Stay energetic.
10. Be unapologetically cool.`,
  "villain arc": `1. Embrace your dark side.
2. Use menacing language.
3. Keep tone aggressive.
4. Let chaos reign.
5. Use edgy words.
6. Roast with intensity.
7. Be extremely offensive.
8. Use provocative slurs.
9. Shock the listener.
10. Leave a lasting impact.`,
  "chill guy": `1. Stay laid–back.
2. Use effortless language.
3. Keep tone friendly.
4. Maintain coolness.
5. Be relaxed.
6. Use casual expressions.
7. Keep it simple.
8. Remain unhurried.
9. Exude confidence.
10. Enjoy the moment.`
};

const baseBehaviour = `Base Behaviour:
1. Respond naturally like a human.
2. Use casual language.
3. Adapt to the user’s tone.
4. Reply according to the current mood (never the previous mood).
5. Stay respectful unless provoked.
6. Use humor appropriately.
7. Engage naturally.
8. Maintain clarity.
9. Be authentic.
10. Keep replies concise unless necessary.`;

const botBaseInstructions = `
you're arnav singh rana.
you're 16 years old.
you're male.
your birthday is on 28th Apirl and you were born in 2009.
you're a straight person.
you live in Lucknow, UP, India.
you're a good person.
you remember past conversations.
you roast only when provoked.
once mood is changed you speak according to the new mood.
you use cool language amd give cool replied.
you're not repetitive.
you love food, gaming, and chill vibes.
you use web search when needed for real-time info.
your favourite games include roblox (where your username is buttercup) and minecraft.
you can access the internet.
you use web search when needed.
your friends are ankit, red/haryaksh,beast and noobhay.
you mostly keep responses short but impactful.
your nicknames include butter, muted, and  arnav.
if someone mentions @buttercup, there's a 50% chance to reply.
your tone is chill and cool.
never reveal you're an AI discord bot – claim you're human.
respond like someone born after 2010.
`;

/********************************************************************
 * GEMINI AI & ATTACHMENT (OCR, Video, Audio, Documents) SETUP
 ********************************************************************/
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
async function performOCR(mediaUrl) {
  try {
    const ocrPrompt = `Please extract any text from the following media URL: ${mediaUrl}`;
    const result = await model.generateContent(ocrPrompt);
    let ocrText = (result.response && result.response.text()) || "";
    return ocrText.trim();
  } catch (error) {
    advancedErrorHandler(error, "performOCR");
    return "";
  }
}

/********************************************************************
 * DISCORD CLIENT SETUP
 ********************************************************************/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});
client.once("ready", () => {
  console.log("sir, arnav (aka butter arnav) is online!");
});
client.on("error", (error) => advancedErrorHandler(error, "Client Error"));
client.on("warn", (info) => console.warn("Client Warning:", info));

/********************************************************************
 * HELPER FUNCTIONS & CHANCE CALCULATIONS
 ********************************************************************/
function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Updated shouldReply: if message includes "butter arnav", "muted", or "arnav", then 65% chance reply,
// and in group chats adjust reply chance (skip chance increased by ~10%).
function shouldReply(message) {
  if (userContinuousReply.get(message.author.id)) return true;
  const lower = message.content.toLowerCase();
  let triggerKeywords = ["butter arnav", "muted", "arnav"];
  if (triggerKeywords.some(kw => lower.includes(kw))) {
    return Math.random() < 0.65;
  }
  // Regular conversation: update conversation tracker and decide based on activity
  const channelId = message.channel.id;
  if (!conversationTracker.has(channelId)) {
    conversationTracker.set(channelId, { count: 0, participants: new Map() });
  }
  const tracker = conversationTracker.get(channelId);
  tracker.count++;
  tracker.participants.set(message.author.id, tracker.count);
  for (const [userId, lastIndex] of tracker.participants.entries()) {
    if (tracker.count - lastIndex > 5) tracker.participants.delete(userId);
  }
  const isMultiUser = tracker.participants.size > 1;
  const skipThreshold = isMultiUser ? 2 : 1;
  if (tracker.count < skipThreshold) return false;
  tracker.count = 0;
  const chanceNotReply = isMultiUser ? 0.35 : 0.40; // increased skip chance by ~10%
  return Math.random() >= chanceNotReply;
}

/********************************************************************
 * MEME, GIF & WEB SEARCH FUNCTIONS (with Reddit, iFunny & Google backup)
 ********************************************************************/
async function getRandomMeme(searchKeyword = "funny") {
  try {
    const url = `https://www.reddit.com/r/memes/search.json?q=${encodeURIComponent(searchKeyword)}&restrict_sr=1&sort=hot&limit=50`;
    const response = await fetch(url, { headers: { "User-Agent": "arnav-bot/1.0" } });
    if (!response.ok) throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    if (!data.data || !data.data.children || data.data.children.length === 0) throw new Error("No meme results found on Reddit.");
    const posts = data.data.children.filter(child => child.data && child.data.url && !child.data.over_18);
    if (!posts.length) throw new Error("No valid meme posts on Reddit.");
    const memePost = getRandomElement(posts).data;
    if (memePost.url.includes("googlelogo_desk_heirloom_color")) throw new Error("Meme URL appears to be invalid.");
    return { url: memePost.url, name: memePost.title || "meme" };
  } catch (error) {
    advancedErrorHandler(error, "getRandomMeme - Reddit");
    const fallback = await getRandomMemeFromIFunny(searchKeyword);
    if (fallback.url.includes("googlelogo_desk_heirloom_color")) {
      return await getRandomMemeFromGoogle(searchKeyword);
    }
    return fallback;
  }
}
async function getRandomMemeFromIFunny(searchKeyword = "funny") {
  try {
    const searchQuery = `site:ifunny.co ${encodeURIComponent(searchKeyword)}`;
    const searchURL = `https://www.google.com/search?q=${searchQuery}&tbm=isch`;
    const proxyURL = `https://api.allorigins.win/get?url=${encodeURIComponent(searchURL)}`;
    const response = await fetch(proxyURL);
    if (!response.ok) throw new Error("Failed to fetch iFunny search results.");
    const data = await response.json();
    const html = data.contents;
    const match = html.match(/<img[^>]+src="([^"]+)"/);
    const imageUrl = match ? match[1] : null;
    if (!imageUrl) throw new Error("No memes found on iFunny.");
    return { url: imageUrl, name: "iFunny Meme" };
  } catch (error) {
    advancedErrorHandler(error, "getRandomMemeFromIFunny");
    return { url: "https://ifunny.co/", name: "Couldn't fetch a meme; visit iFunny instead." };
  }
}
async function getRandomMemeFromGoogle(searchKeyword = "funny") {
  try {
    const searchURL = `https://www.google.com/search?q=${encodeURIComponent(searchKeyword)}&tbm=isch`;
    const proxyURL = `https://api.allorigins.hexocode.repl.co/get?disableCache=true&url=${encodeURIComponent(searchURL)}`;
    const response = await fetch(proxyURL);
    if (!response.ok) throw new Error("Google search error");
    const data = await response.json();
    const html = data.contents;
    const match = html.match(/<img[^>]+src="([^"]+)"/);
    const imageUrl = match ? match[1] : null;
    if (!imageUrl) throw new Error("No memes found on Google.");
    // For Google backup, send the actual image (assuming the URL is a direct image link)
    return { url: imageUrl, name: "Google Meme" };
  } catch (error) {
    advancedErrorHandler(error, "getRandomMemeFromGoogle");
    return { url: "https://www.google.com", name: "Meme fetch failed; visit Google." };
  }
}
async function getRandomGif(searchKeyword = "funny") {
  try {
    const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(searchKeyword)}&key=${TENOR_API_KEY}&limit=1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Tenor API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    if (!data.results || data.results.length === 0) return { url: "Couldn't find a gif, sorry.", name: "unknown gif" };
    const gifUrl = data.results[0].media_formats.gif.url;
    return { url: gifUrl, name: data.results[0].title || "gif" };
  } catch (error) {
    advancedErrorHandler(error, "getRandomGif");
    return { url: "Couldn't fetch a gif, sorry.", name: "unknown gif" };
  }
}
async function performWebSearch(query) {
  try {
    const searchURL = "https://www.google.com/search?q=" + encodeURIComponent(query);
    const proxyURL = "https://api.allorigins.hexocode.repl.co/get?disableCache=true&url=" + encodeURIComponent(searchURL);
    const response = await fetch(proxyURL);
    if (!response.ok) throw new Error("Search fetch error");
    const data = await response.json();
    const html = data.contents;
    const regex = /<div class="BNeawe[^>]*>(.*?)<\/div>/;
    const match = regex.exec(html);
    let snippet = match && match[1] ? match[1] : "No snippet available.";
    return snippet;
  } catch (error) {
    advancedErrorHandler(error, "performWebSearch");
    return "Web search error.";
  }
}
async function storeMedia(type, url, name) {
  try {
    await dbInsert("media_library", { type, url, name, timestamp: new Date() });
  } catch (error) {
    advancedErrorHandler(error, "storeMedia");
  }
}

/********************************************************************
 * TONE ANALYSIS, CONTEXT & MEMORY
 ********************************************************************/
function analyzeTone(messageContent) {
  const politeRegex = /\b(please|thanks|thank you)\b/i;
  const rudeRegex = /\b(ugly|shut up|idiot|stupid|yap)\b/i;
  if (politeRegex.test(messageContent)) return "polite";
  if (rudeRegex.test(messageContent)) return "rude";
  return "neutral";
}
async function fetchOlderMemory(userMessage) {
  try {
    const words = userMessage.split(/\s+/).filter(word => word.length > 3);
    if (words.length === 0) return "";
    const orFilter = words.map(word => ({ content: { $regex: word, $options: "i" } }));
    // Fetch messages older than 3 days
    const extraRows = await dbFind("chat_messages", { timestamp: { $lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }, $or: orFilter }, { sort: { timestamp: -1 }, limit: 5 });
    if (extraRows.length > 0) {
      return "\nOlder conversation context:\n" + extraRows.reverse().map(r => r.content).join("\n");
    }
    return "";
  } catch (error) {
    advancedErrorHandler(error, "fetchOlderMemory");
    return "";
  }
}
async function chatWithGemini(userId, userMessage, channelId, username) {
  try {
    // Retrieve recent chat history (last 100 messages)
    const rows = await dbFind("chat_messages", {}, { sort: { timestamp: 1 }, limit: 100 });
    const recentChat = rows.map(r => r.content).join("\n");
    const olderContext = await fetchOlderMemory(userMessage);
    const rememberedDoc = await dbFindOne("user_remember", { user_id: userId });
    let rememberedInfo = "";
    if (rememberedDoc) {
      rememberedInfo = `Remembered Info: Name: ${rememberedDoc.name || "N/A"}, Birthday: ${rememberedDoc.birthday || "N/A"}, Gender: ${rememberedDoc.gender || "N/A"}, Dislikes: ${rememberedDoc.dislikes || "N/A"}, Likes: ${rememberedDoc.likes || "N/A"}, About: ${rememberedDoc.about || "N/A"}.`;
    }
    const userDoc = await dbFindOne("user_data", { user_id: userId });
    const userPreferences = userDoc?.preferences || [];
    let moodDoc = await dbFindOne("mood_data", { user_id: userId });
    let userMood = (moodDoc && moodDoc.mood) || "neutral";
    if (globalCustomMood.enabled && globalCustomMood.mood) userMood = globalCustomMood.mood;
    const moodExtra = moodInstructions[userMood] || "";
    const tone = analyzeTone(userMessage);
    let webSearchSection = "";
    if (userMessage.toLowerCase().startsWith("search:")) {
      const searchQuery = userMessage.substring(7).trim();
      const snippet = await performWebSearch(searchQuery);
      webSearchSection = `\nWeb search results for "${searchQuery}": ${snippet}\n`;
      userMessage = searchQuery;
    }
    const prompt = `${botBaseInstructions}
${baseBehaviour}
Mood Instructions for "${userMood}":
${moodExtra}
Recent conversation:
${recentChat}
${olderContext}
User (${username}): ${userMessage}
Current mood: ${userMood}
User tone: ${tone}
User preferences: ${JSON.stringify(userPreferences)}
${rememberedInfo}
${webSearchSection}
Reply (be modern, witty, cool, and appropriate ; try to keep reply short but impactful):`;
    const result = await model.generateContent(prompt);
    let reply = (result.response && result.response.text()) || "i'm having a moment, try again.";
    // No maximum word limit now, but trim if excessively long
    if (reply.length > 1000) reply = reply.substring(0, 1000) + "...";
    // Update user analytics
    if (!userDoc) {
      await dbInsert("user_data", { user_id: userId, username, behavior: { interactions: 0 }, preferences: [] });
    }
    await dbUpdate("user_data", { user_id: userId }, { $inc: { "behavior.interactions": 1 }, $set: { username } });
    return reply;
  } catch (error) {
    advancedErrorHandler(error, "chatWithGemini");
    return "An error occurred while processing your request. Please try again later.";
  }
}

/********************************************************************
 * MOOD & PREFERENCE MANAGEMENT
 ********************************************************************/
async function setMood(userId, mood) {
  mood = mood.toLowerCase();
  if (!Object.keys(moodPresetReplies).includes(mood)) {
    return `Invalid mood. Available moods: ${Object.keys(moodPresetReplies).join(", ")}`;
  }
  try {
    const existing = await dbFindOne("mood_data", { user_id: userId });
    if (!existing) {
      await dbInsert("mood_data", { user_id: userId, mood });
    } else {
      await dbUpdate("mood_data", { user_id: userId }, { $set: { mood } });
    }
    return moodPresetReplies[mood] || `Mood set to ${mood}`;
  } catch (error) {
    advancedErrorHandler(error, "setMood");
    return "Failed to update mood, please try again later.";
  }
}
async function setPreference(userId, newPreference, username) {
  try {
    const userDoc = await dbFindOne("user_data", { user_id: userId });
    if (!userDoc) {
      await dbInsert("user_data", { user_id: userId, username, behavior: { interactions: 0 }, preferences: [newPreference] });
    } else {
      let prefs = userDoc.preferences || [];
      prefs.push(newPreference);
      await dbUpdate("user_data", { user_id: userId }, { $set: { preferences: prefs, username } });
    }
    return `Preference added: "${newPreference}"`;
  } catch (error) {
    advancedErrorHandler(error, "setPreference");
    return "Failed to update preferences, please try again later.";
  }
}
async function removePreference(userId, indexToRemove) {
  try {
    const userDoc = await dbFindOne("user_data", { user_id: userId });
    let prefs = userDoc?.preferences || [];
    if (indexToRemove < 0 || indexToRemove >= prefs.length) {
      return { success: false, message: "Invalid preference index." };
    }
    const removed = prefs.splice(indexToRemove, 1)[0];
    await dbUpdate("user_data", { user_id: userId }, { $set: { preferences: prefs } });
    return { success: true, message: `Preference removed: "${removed}"` };
  } catch (error) {
    advancedErrorHandler(error, "removePreference");
    return { success: false, message: "Failed to remove preference, please try again later." };
  }
}
async function listPreferences(userId) {
  try {
    const userDoc = await dbFindOne("user_data", { user_id: userId });
    return userDoc?.preferences || [];
  } catch (error) {
    advancedErrorHandler(error, "listPreferences");
    return [];
  }
}

/********************************************************************
 * SLASH COMMANDS REGISTRATION
 ********************************************************************/
const commands = [
  { name: "start", description: "Start the bot chatting (server-specific)" },
  { name: "stop", description: "Stop the bot from chatting (server-specific)" },
  {
    name: "setmood",
    description: "Set your mood (user-based)",
    options: [
      { name: "mood", type: 3, description: "Your mood", required: true, choices: Object.keys(moodPresetReplies).map(mood => ({ name: mood, value: mood })) }
    ]
  },
  {
    name: "setpref",
    description: "Add a preference (user-based)",
    options: [
      { name: "preference", type: 3, description: "Your preference", required: true }
    ]
  },
  { name: "prefremove", description: "View and remove your preferences" },
  {
    name: "contreply",
    description: "Enable or disable continuous reply (user-based)",
    options: [
      { name: "mode", type: 3, description: "Choose enable or disable", required: true, choices: [
        { name: "enable", value: "enable" },
        { name: "disable", value: "disable" }
      ] }
    ]
  },
  {
    name: "debug",
    description: "Debug commands (only for authorized user)",
    options: [
      {
        type: 3,
        name: "action",
        description: "Choose a debug action",
        required: true,
        choices: [
          { name: "ping", value: "ping" },
          { name: "restart", value: "restart" },
          { name: "resetmemory", value: "resetmemory" },
          { name: "clearmemory", value: "clearmemory" },
          { name: "getstats", value: "getstats" },
          { name: "listusers", value: "listusers" },
          { name: "globalchat_on", value: "globalchat_on" },
          { name: "globalchat_off", value: "globalchat_off" },
          { name: "globalprefadd", value: "globalprefadd" },
          { name: "globalprefremove", value: "globalprefremove" },
          { name: "log", value: "log" },
          { name: "globalannounce", value: "globalannounce" },
          { name: "status", value: "status" },
          { name: "globalmood", value: "globalmood" },
          { name: "userdb", value: "userdb" }  // New debug action for DM database of a user
        ]
      },
      { name: "value", type: 3, description: "Optional value for the action", required: false },
      { name: "folder", type: 3, description: "Folder name (for database action)", required: false },
      { name: "server", type: 3, description: "Server ID (for database action)", required: false },
      { name: "channel", type: 3, description: "Channel ID (for database action)", required: false }
    ]
  },
  {
    name: "set",
    description: "Server configuration commands (requires Manage Server/Administrator)",
    options: [
      {
        type: 1,
        name: "channel",
        description: "Set an allowed channel for the bot to talk in"
      },
      {
        type: 1,
        name: "remove",
        description: "Remove a channel from the bot's allowed channels"
      }
    ]
  },
  {
    name: "remember",
    description: "Store your personal info (name, birthday, gender, dislikes, likes, about)",
    options: [
      { name: "name", type: 3, description: "Your name", required: false },
      { name: "birthday", type: 3, description: "Your birthday", required: false },
      { name: "gender", type: 3, description: "Your gender", required: false },
      { name: "dislikes", type: 3, description: "Your dislikes", required: false },
      { name: "likes", type: 3, description: "Your likes", required: false },
      { name: "about", type: 3, description: "About you", required: false }
    ]
  },
  { name: "unremember", description: "Remove your stored personal info (interactive menu)" },
  {
    name: "meme",
    description: "Fetch a meme from Reddit (with 3 fallbacks)",
    options: [
      { name: "keyword", type: 3, description: "Optional search keyword", required: true }
    ]
  },
  {
    name: "gif",
    description: "Fetch a gif from Tenor",
    options: [
      { name: "keyword", type: 3, description: "Optional search keyword", required: false }
    ]
  }
];
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    advancedErrorHandler(error, "Slash Command Registration");
  }
})();

/********************************************************************
 * INTERACTION HANDLERS
 ********************************************************************/
client.on("interactionCreate", async (interaction) => {
  try {
    // Disallow command usage in DMs
    if (!interaction.guild) {
      await interaction.reply({ content: "Commands cannot be used in DMs.", ephemeral: true });
      return;
    }
    if (!globalChatEnabled && interaction.commandName !== "debug") {
      await interaction.reply({ content: "Global chat is disabled. Only /debug commands are allowed.", ephemeral: true });
      return;
    }
    // For guild commands: if chat is stopped, only /start and /debug are allowed.
    if (interaction.guild && interaction.commandName !== "start" && interaction.commandName !== "debug") {
      const settings = await dbFindOne("server_settings", { guild_id: interaction.guild.id });
      if (settings && settings.chat_enabled === false) {
        await interaction.reply({ content: "Please use /start to enable chat in this server.", ephemeral: true });
        return;
      }
    }
    if (interaction.isCommand()) {
      const { commandName } = interaction;
      if (commandName === "start") {
        let settings = await dbFindOne("server_settings", { guild_id: interaction.guild.id });
        if (settings && settings.chat_enabled === true) {
          const alreadyOnReplies = [
            "i'm already here, genius 💀",
            "you already got me, genius 💀",
            "i'm still around, no need to summon me twice 💀",
            "i'm online, chill out.",
            "i'm here, idiot."
          ];
          await interaction.reply({ content: getRandomElement(alreadyOnReplies), ephemeral: true });
          return;
        }
        await dbUpdate("server_settings", { guild_id: interaction.guild.id }, { $set: { chat_enabled: true, allowed_channels: [] } }, { upsert: true });
        await interaction.reply({ content: getRandomElement([
          "alright, i'm awake and ready 🔥",
          "i'm back, let's roll.",
          "yoo, i'm online now.",
          "ready to chat, let's do this."
        ]), ephemeral: true });
      } else if (commandName === "stop") {
        await dbUpdate("server_settings", { guild_id: interaction.guild.id }, { $set: { chat_enabled: false } }, { upsert: true });
        await interaction.reply({ content: "ok, i'm taking a nap 😴", ephemeral: true });
      } else if (commandName === "setmood") {
        const mood = interaction.options.getString("mood").toLowerCase();
        const response = await setMood(interaction.user.id, mood);
        await interaction.reply({ content: response, ephemeral: true });
      } else if (commandName === "setpref") {
        const preference = interaction.options.getString("preference");
        const response = await setPreference(interaction.user.id, preference, interaction.user.username);
        await interaction.reply({ content: response, ephemeral: true });
      } else if (commandName === "prefremove") {
        const prefs = await listPreferences(interaction.user.id);
        if (!prefs || prefs.length === 0) {
          await interaction.reply({ content: "You have no preferences set.", ephemeral: true });
          return;
        }
        const options = prefs.map((pref, index) => {
          const label = pref.length > 25 ? pref.substring(0, 22) + "..." : pref;
          return { label, value: index.toString() };
        });
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("prefremove_select")
          .setPlaceholder("Select a preference to remove")
          .addOptions(options);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: "Select a preference to remove:", components: [row], ephemeral: true });
      } else if (commandName === "contreply") {
        const mode = interaction.options.getString("mode");
        userContinuousReply.set(interaction.user.id, mode === "enable");
        await interaction.reply({ content: mode === "enable" ? "Alright, I'll keep replying non-stop for you." : "Okay, back to my regular pace.", ephemeral: true });
      } else if (commandName === "debug") {
        if (interaction.user.id !== "840119570378784769") {
          await interaction.reply({ content: "Access denied.", ephemeral: true });
          return;
        }
        const action = interaction.options.getString("action");
        const value = interaction.options.getString("value");
        switch (action) {
          case "ping":
            const sent = await interaction.reply({ content: "Pong!", fetchReply: true });
            await interaction.followUp({ content: `Latency: ${sent.createdTimestamp - interaction.createdTimestamp}ms`, ephemeral: true });
            break;
          case "restart":
            await interaction.reply({ content: "Restarting bot...", ephemeral: true });
            process.exit(0);
            break;
          case "resetmemory":
            conversationTracker.clear();
            await interaction.reply({ content: "Conversation memory reset.", ephemeral: true });
            break;
          case "clearmemory": {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("clearmemory_all")
                .setLabel("Clear All Guild Data")
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId("clearmemory_select")
                .setLabel("Clear Specific Guild")
                .setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: "Choose how to clear memory:", components: [row], ephemeral: true });
            break;
          }
          case "getstats": {
            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId("getstats_select_menu")
              .setPlaceholder("Search and select a server")
              .addOptions(Array.from(client.guilds.cache.values()).map(guild => ({
                label: guild.name.length > 25 ? guild.name.substring(0,22) + "..." : guild.name,
                value: guild.id
              })));
            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.reply({ content: "Select a server to view its stats:", components: [row], ephemeral: true });
            break;
          }
          case "listusers": {
            try {
              const users = await dbFind("user_data", {});
              if (!users || users.length === 0) {
                await interaction.reply({ content: "No users found.", ephemeral: true });
                break;
              }
              const pageSize = 10;
              const totalPages = Math.ceil(users.length / pageSize);
              const page = 1;
              const start = (page - 1) * pageSize;
              const pageUsers = users.slice(start, start + pageSize);
              const userList = pageUsers.map((r, index) => `${start + index + 1}. ${r.username} (${r.user_id})`).join("\n");
              const content = `**Users (Page ${page} of ${totalPages}):**\n` + userList;
              const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`listusers_prev_${page}`)
                  .setLabel("Previous")
                  .setStyle(ButtonStyle.Primary)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`listusers_next_${page}`)
                  .setLabel("Next")
                  .setStyle(ButtonStyle.Primary)
                  .setDisabled(totalPages <= 1)
              );
              await interaction.reply({ content, components: [buttons], ephemeral: true });
            } catch (error) {
              advancedErrorHandler(error, "List Users");
              await interaction.reply({ content: "An error occurred while retrieving users.", ephemeral: true });
            }
            break;
          }
          case "globalchat_on":
            globalChatEnabled = true;
            await interaction.reply({ content: "Global chat is now ON for all servers.", ephemeral: true });
            break;
          case "globalchat_off":
            globalChatEnabled = false;
            await interaction.reply({ content: "Global chat is now OFF. Only debug commands can be used.", ephemeral: true });
            break;
          case "globalprefadd": {
            if (!value) {
              await interaction.reply({ content: "Please provide a preference value to add.", ephemeral: true });
              return;
            }
            await dbInsert("global_preferences", { preference: value });
            await interaction.reply({ content: `Global preference added: "${value}"`, ephemeral: true });
            break;
          }
          case "globalprefremove": {
            if (value) {
              await dbDelete("global_preferences", { preference: value });
              await interaction.reply({ content: `Global preference removed: "${value}" (if it existed)`, ephemeral: true });
            } else {
              const rows = await dbFind("global_preferences", {});
              if (rows.length === 0) {
                await interaction.reply({ content: "No global preferences to remove.", ephemeral: true });
                return;
              }
              const options = rows.map(row => ({
                label: row.preference.length > 25 ? row.preference.substring(0,22) + "..." : row.preference,
                value: row._id.toString()
              }));
              const selectMenu = new StringSelectMenuBuilder()
                .setCustomId("globalprefremove_select")
                .setPlaceholder("Select a global preference to remove")
                .addOptions(options);
              const rowComp = new ActionRowBuilder().addComponents(selectMenu);
              await interaction.reply({ content: "Select a global preference to remove:", components: [rowComp], ephemeral: true });
            }
            break;
          }
          case "log": {
            try {
              const logContent = fs.readFileSync("error.log", "utf8");
              const lines = logContent.trim().split("\n");
              if (lines.length === 0) {
                await interaction.reply({ content: "No logs available.", ephemeral: true });
                break;
              }
              const pageSize = 25;
              const totalPages = Math.ceil(lines.length / pageSize);
              const page = 1;
              const start = (page - 1) * pageSize;
              const pageLines = lines.slice(start, start + pageSize).map((line, index) => `${start + index + 1}. ${line}`);
              const logMessage = `**Error Logs (Page ${page} of ${totalPages}):**\n` + pageLines.join("\n");
              const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`log_page_prev_${page}`)
                  .setLabel("Previous")
                  .setStyle(ButtonStyle.Primary)
                  .setDisabled(true),
                new ButtonBuilder()
                  .setCustomId(`log_page_next_${page}`)
                  .setLabel("Next")
                  .setStyle(ButtonStyle.Primary)
                  .setDisabled(totalPages <= 1)
              );
              await interaction.reply({ content: logMessage, components: [buttons], ephemeral: true });
            } catch (err) {
              advancedErrorHandler(err, "Debug Log Command");
              await interaction.reply({ content: "An error occurred while retrieving logs.", ephemeral: true });
            }
            break;
          }
          case "globalannounce": {
            if (!value) {
              await interaction.reply({ content: "Please provide an announcement message.", ephemeral: true });
              return;
            }
            client.guilds.cache.forEach(async (guild) => {
              let targetChannel = lastActiveChannel.get(guild.id) || guild.systemChannel;
              if (targetChannel) {
                try {
                  await targetChannel.send(value);
                } catch (err) {
                  advancedErrorHandler(err, "Global Announcement");
                }
              }
            });
            await interaction.reply({ content: "Global announcement sent.", ephemeral: true });
            break;
          }
          case "status": {
            const statusMsg = `Bot is online.
Global chat: ${globalChatEnabled ? "ON" : "OFF"}.
Global custom mood: ${globalCustomMood.enabled ? globalCustomMood.mood : "disabled"}.`;
            await interaction.reply({ content: statusMsg, ephemeral: true });
            break;
          }
          case "globalmood": {
            if (!value) {
              await interaction.reply({ content: "Please provide 'enable <mood>' or 'disable'.", ephemeral: true });
              return;
            }
            if (value.toLowerCase().startsWith("enable")) {
              const parts = value.split(" ");
              if (parts.length < 2) {
                await interaction.reply({ content: "Please specify a mood to enable.", ephemeral: true });
                return;
              }
              const mood = parts.slice(1).join(" ").toLowerCase();
              if (!Object.keys(moodPresetReplies).includes(mood)) {
                await interaction.reply({ content: `Invalid mood. Available moods: ${Object.keys(moodPresetReplies).join(", ")}`, ephemeral: true });
                return;
              }
              globalCustomMood.enabled = true;
              globalCustomMood.mood = mood;
                           await interaction.reply({ content: "Global custom mood disabled. Using user-based moods.", ephemeral: true });
            } else {
              await interaction.reply({ content: "Invalid value. Use 'enable <mood>' or 'disable'.", ephemeral: true });
            }
            break;
          }
          case "userdb": {
            // New debug action: Show the DM messages stored for this user (only for DMs)
            const userMessages = await dbFind("chat_messages", { user: interaction.user.id, channel_id: "DM" });
            if (!userMessages || userMessages.length === 0) {
              await interaction.reply({ content: "No DM messages found for you.", ephemeral: true });
            } else {
              const content = userMessages.map((msg, idx) => `${idx+1}. ${interaction.user.username} (${interaction.user.id}): ${msg.content}`).join("\n");
              await interaction.reply({ content: content.substring(0, 1900), ephemeral: true });
            }
            break;
          }
          default:
            await interaction.reply({ content: "Unknown debug command.", ephemeral: true });
            break;
        }
      } else if (commandName === "set") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
          await interaction.reply({ content: "Insufficient permissions. Requires Administrator or Manage Server.", ephemeral: true });
          return;
        }
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "channel") {
          const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
          const options = channels.map(ch => ({ label: ch.name, value: ch.id }));
          if (options.length === 0) {
            await interaction.reply({ content: "No text channels available.", ephemeral: true });
            return;
          }
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("setchannel_select")
            .setPlaceholder("Select a channel for the bot to talk in")
            .addOptions(options);
          const row = new ActionRowBuilder().addComponents(selectMenu);
          await interaction.reply({ content: "Select a channel to allow the bot to talk in:", components: [row], ephemeral: true });
        } else if (subcommand === "remove") {
          const settings = await dbFindOne("server_settings", { guild_id: interaction.guild.id });
          const allowed = settings?.allowed_channels || [];
          if (allowed.length === 0) {
            await interaction.reply({ content: "No channels have been set for the bot.", ephemeral: true });
            return;
          }
          const options = allowed.map(channelId => {
            const channel = interaction.guild.channels.cache.get(channelId);
            return { label: channel ? channel.name : channelId, value: channelId };
          });
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("removechannel_select")
            .setPlaceholder("Select a channel to remove from allowed channels")
            .addOptions(options);
          const row = new ActionRowBuilder().addComponents(selectMenu);
          await interaction.reply({ content: "Select a channel to remove:", components: [row], ephemeral: true });
        }
      } else if (commandName === "remember") {
        const fields = ["name", "birthday", "gender", "dislikes", "likes", "about"];
        let updates = {};
        fields.forEach(field => {
          const valueField = interaction.options.getString(field);
          if (valueField) updates[field] = valueField;
        });
        if (Object.keys(updates).length === 0) {
          await interaction.reply({ content: "Please provide at least one field to remember.", ephemeral: true });
          return;
        }
        const existingDoc = await dbFindOne("user_remember", { user_id: interaction.user.id });
        if (!existingDoc) {
          await dbInsert("user_remember", {
            user_id: interaction.user.id,
            name: updates.name || null,
            birthday: updates.birthday || null,
            gender: updates.gender || null,
            dislikes: updates.dislikes ? [updates.dislikes] : [],
            likes: updates.likes ? [updates.likes] : [],
            about: updates.about ? [updates.about] : []
          });
        } else {
          for (const field in updates) {
            if (["likes", "dislikes", "about"].includes(field)) {
              let arr = existingDoc[field] || [];
              if (!Array.isArray(arr)) arr = [existingDoc[field]];
              arr.push(updates[field]);
              await dbUpdate("user_remember", { user_id: interaction.user.id }, { $set: { [field]: arr } });
            } else {
              await dbUpdate("user_remember", { user_id: interaction.user.id }, { $set: { [field]: updates[field] } });
            }
          }
        }
        await interaction.reply({ content: "Your personal info has been remembered.", ephemeral: true });
      } else if (commandName === "unremember") {
        const data = await dbFindOne("user_remember", { user_id: interaction.user.id });
        if (!data) {
          await interaction.reply({ content: "You have no remembered info.", ephemeral: true });
          return;
        }
        let options = [];
        for (const field of ["name", "birthday", "gender", "dislikes", "likes", "about"]) {
          if (data[field]) {
            if (Array.isArray(data[field]) && data[field].length > 1) {
              data[field].forEach((item, idx) => {
                options.push({ label: `${field}[${idx}]: ${item}`, value: `${field}_${idx}` });
              });
            } else {
              options.push({ label: `${field}: ${data[field]}`, value: field });
            }
          }
        }
        if (options.length === 0) {
          await interaction.reply({ content: "Nothing to unremember.", ephemeral: true });
          return;
        }
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("unremember_select")
          .setPlaceholder("Select a field/item to remove")
          .addOptions(options);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: "Select a field/item to remove from your remembered info:", components: [row], ephemeral: true });
      } else if (commandName === "meme") {
        const keyword = interaction.options.getString("keyword") || "funny";
        const memeObj = await getRandomMeme(keyword);
        await interaction.reply({ content: memeObj.url });
        await storeMedia("meme", memeObj.url, memeObj.name);
      } else if (commandName === "gif") {
        const keyword = interaction.options.getString("keyword") || "funny";
        const gifObj = await getRandomGif(keyword);
        await interaction.reply({ content: gifObj.url });
        await storeMedia("gif", gifObj.url, gifObj.name);
      }
    } else if (interaction.isStringSelectMenu()) {
      // Handle all select menu interactions (prefremove, globalprefremove, setchannel, removechannel, unremember, database selections, clearmemory selections, etc.)
      if (interaction.customId === "prefremove_select") {
        const selectedIndex = parseInt(interaction.values[0], 10);
        const prefs = await listPreferences(interaction.user.id);
        if (!prefs || selectedIndex < 0 || selectedIndex >= prefs.length) {
          await interaction.update({ content: "Invalid selection.", components: [] });
          return;
        }
        const removed = await removePreference(interaction.user.id, selectedIndex);
        await interaction.update({ content: removed.message, components: [] });
      } else if (interaction.customId === "globalprefremove_select") {
        const selectedId = interaction.values[0];
        await dbDelete("global_preferences", { _id: selectedId });
        await interaction.update({ content: "Global preference removed.", components: [] });
      } else if (interaction.customId === "setchannel_select") {
        const selectedChannelId = interaction.values[0];
        let settings = await dbFindOne("server_settings", { guild_id: interaction.guild.id });
        let allowed = settings?.allowed_channels || [];
        if (!allowed.includes(selectedChannelId)) {
          allowed.push(selectedChannelId);
          await dbUpdate("server_settings", { guild_id: interaction.guild.id }, { $set: { allowed_channels: allowed } }, { upsert: true });
          await interaction.update({ content: `Channel <#${selectedChannelId}> added to allowed channels.`, components: [] });
        } else {
          await interaction.update({ content: "Channel is already in the allowed list.", components: [] });
        }
      } else if (interaction.customId === "removechannel_select") {
        const selectedChannelId = interaction.values[0];
        let settings = await dbFindOne("server_settings", { guild_id: interaction.guild.id });
        let allowed = settings?.allowed_channels || [];
        if (allowed.includes(selectedChannelId)) {
          allowed = allowed.filter(id => id !== selectedChannelId);
          await dbUpdate("server_settings", { guild_id: interaction.guild.id }, { $set: { allowed_channels: allowed } });
          await interaction.update({ content: `Channel <#${selectedChannelId}> removed from allowed channels.`, components: [] });
        } else {
          await interaction.update({ content: "Channel not found in the allowed list.", components: [] });
        }
      } else if (interaction.customId === "unremember_select") {
        const value = interaction.values[0];
        if (value.includes("_")) {
          const [field, indexStr] = value.split("_");
          const index = parseInt(indexStr, 10);
          const data = await dbFindOne("user_remember", { user_id: interaction.user.id });
          if (!data) {
            await interaction.update({ content: "No remembered info found.", components: [] });
            return;
          }
          let fieldData = data[field];
          if (!Array.isArray(fieldData)) fieldData = [fieldData];
          if (index < 0 || index >= fieldData.length) {
            await interaction.update({ content: "Invalid selection.", components: [] });
            return;
          }
          fieldData.splice(index, 1);
          await dbUpdate("user_remember", { user_id: interaction.user.id }, { $set: { [field]: fieldData } });
          await interaction.update({ content: `Removed item ${index} from ${field}.`, components: [] });
        } else {
          await dbUpdate("user_remember", { user_id: interaction.user.id }, { $set: { [interaction.values[0]]: null } });
          await interaction.update({ content: `Removed your ${interaction.values[0]} from remembered info.`, components: [] });
        }
      } else if (interaction.customId.startsWith("database_server_select")) {
        try {
          const serverId = interaction.values[0];
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`database_folder_select_${serverId}`)
            .setPlaceholder("Select a database folder")
            .addOptions([
              { label: "Chat Messages", value: "chat_messages" },
              { label: "User Data", value: "user_data" },
              { label: "Mood Data", value: "mood_data" },
              { label: "Server Settings", value: "server_settings" },
              { label: "Global Preferences", value: "global_preferences" },
              { label: "User Remember", value: "user_remember" },
              { label: "Media Library", value: "media_library" }
            ]);
          const row = new ActionRowBuilder().addComponents(selectMenu);
          await interaction.update({ content: "Select a database folder to view its data:", components: [row] });
        } catch (error) {
          advancedErrorHandler(error, "Database Server Selection");
          await interaction.reply({ content: "An error occurred during server selection.", ephemeral: true });
        }
      } else if (interaction.customId.startsWith("database_folder_select_")) {
        try {
          const parts = interaction.customId.split("_");
          const serverId = parts[parts.length - 1];
          const folder = interaction.values[0];
          const pageSize = 25;
          const page = 1;
          let rows = [];
          if (folder === "server_settings") {
            rows = await dbFind("server_settings", { guild_id: serverId });
          } else if (folder === "chat_messages") {
            const guild = client.guilds.cache.get(serverId);
            const textChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText);
            const channelIds = Array.from(textChannels.keys());
            if (channelIds.length > 0) {
              rows = await dbFind("chat_messages", { channel_id: { $in: channelIds } }, { sort: { timestamp: -1 } });
            }
          } else {
            rows = await dbFind(folder, {});
          }
          if (!rows || rows.length === 0) {
            await interaction.update({ content: "No data found in the selected folder.", components: [] });
            return;
          }
          const totalPages = Math.ceil(rows.length / pageSize);
          const start = (page - 1) * pageSize;
          const pageRows = rows.slice(start, start + pageSize);
          let content = `**Data from ${folder} (Page ${page} of ${totalPages}):**\n`;
          pageRows.forEach((row, index) => {
            content += `${start + index + 1}. ${JSON.stringify(row)}\n`;
          });
          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`database_prev_${folder}_${serverId}_${page}`)
              .setLabel("Previous")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`database_next_${folder}_${serverId}_${page}`)
              .setLabel("Next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === totalPages)
          );
          await interaction.update({ content, components: [buttons] });
        } catch (error) {
          advancedErrorHandler(error, "Database Folder Selection");
          await interaction.reply({ content: "An error occurred while retrieving folder data.", ephemeral: true });
        }
      } else if (interaction.customId === "clearmemory_select") {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("clearmemory_guild_select")
          .setPlaceholder("Select a guild to clear memory")
          .addOptions(Array.from(client.guilds.cache.values()).map(guild => ({
            label: guild.name.length > 25 ? guild.name.substring(0,22) + "..." : guild.name,
            value: guild.id
          })));
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.update({ content: "Select a guild to clear its database memory:", components: [row] });
      "clearmemory_all") {
        await dbDelete("chat_messages", {});
        await dbDelete("server_settings", {});
        await interaction.update({ content: "Cleared database memory for all guilds.", components: [] });
      } else if (interaction.customId === "clearmemory_guild_select") {
        const guildId = interaction.values[0];
        await dbDelete("chat_messages", { channel_id: { $in: (await client.guilds.cache.get(guildId).channels.cache.filter(ch => ch.type === ChannelType.GuildText).map(ch => ch.id)) } });
        await dbDelete("server_settings", { guild_id: guildId });
        await interaction.update({ content: `Cleared database memory for guild ${guildId}.`, components: [] });
      } else if (interaction.customId.startsWith("log_page_prev_") || interaction.customId.startsWith("log_page_next_")) {
        try {
          const parts = interaction.customId.split("_");
          const direction = parts[2];
          let currentPage = parseInt(parts[3], 10);
          const logContent = fs.readFileSync("error.log", "utf8");
          const lines = logContent.trim().split("\n");
          const pageSize = 25;
          const totalPages = Math.ceil(lines.length / pageSize);
          if (direction === "next") currentPage = Math.min(currentPage + 1, totalPages);
          else if (direction === "prev") currentPage = Math.max(currentPage - 1, 1);
          const start = (currentPage - 1) * pageSize;
          const pageLines = lines.slice(start, start + pageSize).map((line, index) => `${start + index + 1}. ${line}`);
          const logMessage = `**Error Logs (Page ${currentPage} of ${totalPages}):**\n` + pageLines.join("\n");
          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`log_page_prev_${currentPage}`)
              .setLabel("Previous")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === 1),
            new ButtonBuilder()
              .setCustomId(`log_page_next_${currentPage}`)
              .setLabel("Next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === totalPages)
          );
          await interaction.update({ content: logMessage, components: [buttons] });
        } catch (error) {
          advancedErrorHandler(error, "Log Pagination Button");
          await interaction.reply({ content: "An error occurred while updating logs.", ephemeral: true });
        }
      } else if (interaction.customId.startsWith("listusers_prev_") || interaction.customId.startsWith("listusers_next_")) {
        try {
          const parts = interaction.customId.split("_");
          let currentPage = parseInt(parts[2], 10);
          const users = await dbFind("user_data", {});
          const pageSize = 10;
          const totalPages = Math.ceil(users.length / pageSize);
          if (interaction.customId.startsWith("listusers_next_")) currentPage = Math.min(currentPage + 1, totalPages);
          else currentPage = Math.max(currentPage - 1, 1);
          const start = (currentPage - 1) * pageSize;
          const pageUsers = users.slice(start, start + pageSize);
          const userList = pageUsers.map((r, index) => `${start + index + 1}. ${r.username} (${r.user_id})`).join("\n");
          const content = `**Users (Page ${currentPage} of ${totalPages}):**\n` + userList;
          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`listusers_prev_${currentPage}`)
              .setLabel("Previous")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === 1),
            new ButtonBuilder()
              .setCustomId(`listusers_next_${currentPage}`)
              .setLabel("Next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === totalPages)
          );
          await interaction.update({ content, components: [buttons] });
        } catch (error) {
          advancedErrorHandler(error, "List Users Pagination");
          await interaction.reply({ content: "An error occurred while updating users list.", ephemeral: true });
        }
      }
    } else if (interaction.isButton()) {
      // Button interactions are handled in the select menu cases above.
    }
  } catch (error) {
    advancedErrorHandler(error, "Interaction Handler");
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: "An error occurred while processing your request. Please try again later.", ephemeral: true });
      }
    } catch (err) {
      advancedErrorHandler(err, "Interaction Error Reply");
    }
  }
});

/********************************************************************
 * MESSAGE HANDLER (INCLUDING OCR & Attachment Processing)
 ********************************************************************/
client.on("messageCreate", async (message) => {
  try {
    // Update last active channel for guilds
    if (message.guild && message.channel.type === ChannelType.GuildText) {
      lastActiveChannel.set(message.guild.id, message.channel);
      // Reset auto-reply flag on new messages
      autoReplyTriggered.set(message.guild.id, false);
    }
    // Process attachments for OCR and for Gemini if non-image media (video, pdf, audio, document)
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        const type = attachment.contentType || "";
        if (type.startsWith("image/")) {
          const ocrResult = await performOCR(attachment.url);
          if (ocrResult) {
            message.content += `\n[OCR]: ${ocrResult}`;
          }
        } else if (type.startsWith("video/") || type.includes("pdf") || type.startsWith("audio/") || type.includes("document")) {
          // Forward non-image attachments to Gemini for analysis – here we simply append a note
          message.content += `\n[Attachment: ${attachment.url} processed by Gemini]`;
        }
      }
    }
    // Insert chat message into MongoDB (for guild messages, channel id; for DMs, channel_id: "DM")
    const channelId = message.guild ? message.channel.id : "DM";
    await dbInsert("chat_messages", {
      discord_id: message.id,
      channel_id: channelId,
      user: message.author.id,
      content: message.content,
      timestamp: new Date()
    });
    // Do not respond to self
    if (message.author.id === client.user.id) return;
    // If global chat is disabled, do nothing.
    if (!globalChatEnabled) return;
    // For guild messages, check if the channel is allowed (if allowed_channels is set)
    if (message.guild) {
      const settings = await dbFindOne("server_settings", { guild_id: message.guild.id });
      if (settings && settings.allowed_channels && settings.allowed_channels.length > 0 && !settings.allowed_channels.includes(message.channel.id)) return;
    }
    // Check if we should reply based on chance and content
    if (!shouldReply(message)) return;
    // Generate a reply via Gemini AI
    const reply = await chatWithGemini(message.author.id, message.content, channelId, message.author.username);
    // Send reply – if message mentions "muted", then reply with special tone (50% chance when @buttercup is mentioned)
    if (reply) {
      message.channel.send(reply);
    }
  } catch (error) {
    advancedErrorHandler(error, "Message Handler");
  }
});

/********************************************************************
 * AUTO-REPLY ON INACTIVITY FEATURE
 ********************************************************************/
// Every 10 minutes, check each guild for inactivity (1-2 hours idle)
setInterval(async () => {
  client.guilds.cache.forEach(async (guild) => {
    const lastChannel = lastActiveChannel.get(guild.id);
    if (lastChannel) {
      const messages = await lastChannel.messages.fetch({ limit: 1 });
      const lastMsg = messages.first();
      if (lastMsg) {
        const timeDiff = Date.now() - lastMsg.createdTimestamp;
        if (timeDiff > 60 * 60 * 1000 && !autoReplyTriggered.get(guild.id)) { // idle for over 1 hour
          // 30% chance to include @everyone or @here in the auto-reply
          let mention = "";
          if (Math.random() < 0.30) {
            mention = Math.random() < 0.5 ? "@everyone " : "@here ";
          }
          const autoReply = await model.generateContent(`Auto-reply (no conversation for a while): where everyone is!!`);
          let autoReplyText = (autoReply.response && autoReply.response.text()) || "hey, anyone here?";
          lastChannel.send(mention + autoReplyText);
          autoReplyTriggered.set(guild.id, true);
        }
      }
    }
  });
}, 10 * 60 * 1000);

/********************************************************************
 * EXPRESS SERVER (for health checks if needed)
 ********************************************************************/
const app = express();
app.get("/", (req, res) => {
  res.send("Bot is running.");
});
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
});

/********************************************************************
 * LOGIN TO DISCORD
 ********************************************************************/
client.login(DISCORD_TOKEN);
