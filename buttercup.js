/********************************************************************
 * MAJOR SECTION 1: IMPORTS, ENVIRONMENT SETUP & MONGODB CONNECTION
 * 1.1: Imports & env configuration
 ********************************************************************/
import {
  Client, GatewayIntentBits, Partials, REST, Routes,
  ActionRowBuilder, StringSelectMenuBuilder, SlashCommandBuilder,
  ChannelType, PermissionsBitField, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";

dotenv.config();

const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const CLIENT_ID        = process.env.DISCORD_CLIENT_ID;
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const TENOR_API_KEY    = process.env.TENOR_API_KEY;
const OWNER_ID         = process.env.OWNER_ID;
const PORT             = process.env.PORT || 3000;
const MONGO_DB_PASSWORD= process.env.MONGO_DB_PASSWORD;
const MONGO_URI        = `mongodb+srv://ankittsu2:${MONGO_DB_PASSWORD}@cluster0.6grcc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const MONGO_DB_NAME    = "discord_bot";

/********************************************************************
 * MAJOR SECTION 2: ADVANCED ERROR HANDLING & PROCESS EVENTS
 * 2.1: Advanced error handler (1.2) & uncaught exception/rejection handlers
 ********************************************************************/
function advancedErrorHandler(error, context = "General") { // 2.1.1
  const timestamp = new Date().toISOString();
  const errorMsg = `[${timestamp}] [${context}] ${error.stack || error}\n`;
  console.error(errorMsg);
  fs.appendFile("error.log", errorMsg, (err) => {
    if (err) console.error("Failed to write to error.log:", err);
  });
}
process.on("uncaughtException", (error) => { advancedErrorHandler(error, "Uncaught Exception"); }); // 2.1.2
process.on("unhandledRejection", (reason) => { advancedErrorHandler(reason, "Unhandled Rejection"); }); // 2.1.3

/********************************************************************
 * MAJOR SECTION 3: MONGODB DATABASE SETUP & HELPER FUNCTIONS
 * 3.1: Connect to MongoDB and export DB helper functions
 ********************************************************************/
let db;
let mongoClient;
async function connectToDatabase() { // 3.1.1
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(MONGO_DB_NAME);
    console.log("✅ Connected to MongoDB database.");
  } catch (error) {
    advancedErrorHandler(error, "MongoDB Connection");
  }
}
connectToDatabase();
process.on("SIGINT", async () => { // 3.1.2: Graceful shutdown
  try {
    await mongoClient.close();
    console.log("MongoDB connection closed.");
  } catch (e) {
    advancedErrorHandler(e, "SIGINT Handler");
  }
  process.exit(0);
});
// 3.2: MongoDB helper functions
async function dbFind(collectionName, filter = {}, options = {}) { // 3.2.1
  try {
    return await db.collection(collectionName).find(filter, options).toArray();
  } catch (error) {
    advancedErrorHandler(error, `dbFind in ${collectionName}`);
    return [];
  }
}
async function dbFindOne(collectionName, filter = {}, options = {}) { // 3.2.2
  try {
    return await db.collection(collectionName).findOne(filter, options);
  } catch (error) {
    advancedErrorHandler(error, `dbFindOne in ${collectionName}`);
    return null;
  }
}
async function dbInsert(collectionName, doc) { // 3.2.3
  try {
    return await db.collection(collectionName).insertOne(doc);
  } catch (error) {
    advancedErrorHandler(error, `dbInsert in ${collectionName}`);
  }
}
async function dbUpdate(collectionName, filter, update, options = {}) { // 3.2.4
  try {
    return await db.collection(collectionName).updateOne(filter, update, options);
  } catch (error) {
    advancedErrorHandler(error, `dbUpdate in ${collectionName}`);
  }
}
async function dbDelete(collectionName, filter) { // 3.2.5
  try {
    return await db.collection(collectionName).deleteMany(filter);
  } catch (error) {
    advancedErrorHandler(error, `dbDelete in ${collectionName}`);
  }
}
// 3.3: Guild settings helper (using MongoDB)
async function setGuildChat(guildId, enabled) { // 3.3.1
  try {
    await dbUpdate("server_settings", { guild_id: guildId }, { $set: { chat_enabled: enabled ? 1 : 0 } }, { upsert: true });
  } catch (error) {
    advancedErrorHandler(error, "setGuildChat");
  }
}
async function getGuildSettings(guildId) { // 3.3.2
  const settings = await dbFindOne("server_settings", { guild_id: guildId });
  if (!settings) return { chat_enabled: 1, allowed_channels: [] };
  return { chat_enabled: settings.chat_enabled, allowed_channels: settings.allowed_channels || [] };
}
async function updateGuildAllowedChannels(guildId, channels) { // 3.3.3
  try {
    await dbUpdate("server_settings", { guild_id: guildId }, { $set: { allowed_channels: channels } }, { upsert: true });
  } catch (error) {
    advancedErrorHandler(error, "updateGuildAllowedChannels");
  }
}

/********************************************************************
 * MAJOR SECTION 4: BOT CONFIGURATION, MOOD & BASE BEHAVIOUR
 * 4.1: Mood preset replies & instructions, base behaviour and bot instructions
 ********************************************************************/
const moodPresetReplies = { // 4.1.1
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
const moodInstructions = { // 4.1.2
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
8. Use provocative language.
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
10. Keep replies concise.`; // 4.1.3
const botBaseInstructions = `
you're arnav singh rana.
you're 16 years old.
you're male.
your birthday is on 28th April and you were born in 2009.
you're a straight person.
you live in Lucknow, UP, India.
you're a good person.
you remember past conversations.
you roast only when provoked.
once mood is changed you speak according to the new mood.
you use cool language and give cool replies.
you're not repetitive.
you love food, gaming, and chill vibes.
you use web search when needed for real-time info.
your favourite games include roblox (where your username is buttercup) and minecraft.
you can access the internet.
your friends are ankit, red/haryaksh, beast and noobhay.
you mostly keep responses short but impactful.
your nicknames include butter, muted, and arnav.
if someone mentions @buttercup, there's a 50% chance to reply.
your tone is chill and cool.
never reveal you're an AI discord bot – claim you're human.
respond like someone born after 2010.
`; // 4.1.4

// Global toggles & state variables
let globalChatEnabled = true; // 4.2
let globalCustomMood = { enabled: false, mood: null };

/********************************************************************
 * MAJOR SECTION 5: GEMINI AI & ATTACHMENT (OCR) SETUP
 * 5.1: Initialize Gemini AI & define OCR function
 ********************************************************************/
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
async function performOCR(mediaUrl) { // 5.1.1
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
 * MAJOR SECTION 6: DISCORD CLIENT SETUP & COMMAND REGISTRATION
 * 6.1: Create Discord client and register slash commands
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
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
client.once("ready", async () => { // 6.1.1: Ready event
  console.log("bot is online!");
  try {
    console.log("Started refreshing application (/) commands.");
    // Use the slashCommands array defined later (Major Section 10)
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    advancedErrorHandler(error, "Slash Command Registration");
  }
  // Assign a default role in each guild if needed
  client.guilds.cache.forEach(async (guild) => { // 6.1.2
    try {
      const roleName = "nico";
      let role = guild.roles.cache.find(r => r.name === roleName);
      if (!role) {
        role = await guild.roles.create({
          name: roleName,
          color: "#FF0000",
          reason: "Auto-created role for the bot"
        });
      }
      const botMember = guild.members.cache.get(client.user.id);
      if (botMember && !botMember.roles.cache.has(role.id)) {
        await botMember.roles.add(role);
        console.log(`Assigned ${roleName} role in guild "${guild.name}"`);
      }
    } catch (error) {
      console.error(`Error in guild "${guild.name}":`, error);
    }
  });
});
client.on("error", (error) => advancedErrorHandler(error, "Client Error")); // 6.1.3
client.on("warn", (info) => console.warn("Client Warning:", info));

/********************************************************************
 * MAJOR SECTION 7: GLOBAL STATE & HELPER FUNCTIONS
 * 7.1: Global conversation tracker, reply settings, and helper functions
 ********************************************************************/
const conversationTracker = new Map(); // 7.1.1
const userContinuousReply = new Map(); // 7.1.2
let lastBotMessageContent = "";
let lastReply = "";
const botMessageIds = new Set();
const lastActiveChannel = new Map();
function getRandomElement(arr) { // 7.1.3
  return arr[Math.floor(Math.random() * arr.length)];
}

/********************************************************************
 * MAJOR SECTION 8: MEME, GIF & WEB SEARCH FUNCTIONS
 * 8.1: Functions to fetch memes and gifs with fallbacks and store media
 ********************************************************************/
async function getRandomMeme(searchKeyword = "funny") { // 8.1.1: Reddit method
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
async function getRandomMemeFromIFunny(searchKeyword = "funny") { // 8.1.2: iFunny fallback
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
async function getRandomMemeFromGoogle(searchKeyword = "funny") { // 8.1.3: Google fallback
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
    return { url: imageUrl, name: "Google Meme" };
  } catch (error) {
    advancedErrorHandler(error, "getRandomMemeFromGoogle");
    return { url: "https://www.google.com", name: "Meme fetch failed; visit Google." };
  }
}
async function getRandomGif(searchKeyword = "funny") { // 8.1.4: Tenor gif fetch
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
async function performWebSearch(query) { // 8.1.5
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
async function storeMedia(type, url, name) { // 8.1.6
  try {
    await dbInsert("media_library", { type, url, name, timestamp: new Date() });
  } catch (error) {
    advancedErrorHandler(error, "storeMedia");
  }
}

/********************************************************************
 * MAJOR SECTION 9: TONE ANALYSIS, CONTEXT, MEMORY & CHAT WITH GEMINI
 * 9.1: Tone analysis, older memory retrieval, and chatWithGemini function
 ********************************************************************/
function analyzeTone(messageContent) { // 9.1.1
  const politeRegex = /\b(please|thanks|thank you)\b/i;
  const rudeRegex = /\b(ugly|shut up|idiot|stupid|yap)\b/i;
  if (politeRegex.test(messageContent)) return "polite";
  if (rudeRegex.test(messageContent)) return "rude";
  return "neutral";
}
async function fetchOlderMemory(userMessage) { // 9.1.2: For messages older than 3 days
  try {
    const words = userMessage.split(/\s+/).filter(word => word.length > 3);
    if (words.length === 0) return "";
    const orFilter = words.map(word => ({ content: { $regex: word, $options: "i" } }));
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
async function chatWithGemini(userId, userMessage) { // 9.1.3
  try {
    // Retrieve recent chat history (limit to 100 messages, sorted oldest first)
    const rows = await dbFind("chat_messages", {}, { sort: { timestamp: 1 }, limit: 100 });
    const recentChat = rows.map(r => r.content).join("\n");
    const olderContext = await fetchOlderMemory(userMessage);
    // Retrieve user remembered info
    const rememberedDoc = await dbFindOne("user_remember", { user_id: userId });
    let rememberedInfo = "";
    if (rememberedDoc) {
      rememberedInfo = `Remembered Info: Name: ${rememberedDoc.name || "N/A"}, Birthday: ${rememberedDoc.birthday || "N/A"}, Gender: ${rememberedDoc.gender || "N/A"}, Dislikes: ${rememberedDoc.dislikes || "N/A"}, Likes: ${rememberedDoc.likes || "N/A"}, About: ${rememberedDoc.about || "N/A"}.`;
    }
    // Retrieve user preferences and mood
    const userDoc = await dbFindOne("user_data", { user_id: userId });
    const userPreferences = userDoc?.preferences || [];
    let moodDoc = await dbFindOne("mood_data", { user_id: userId });
    let userMood = moodDoc?.mood ?? "neutral";
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
User (${userDoc?.username || "user"}): ${userMessage}
Current mood: ${userMood}
User tone: ${tone}
User preferences: ${JSON.stringify(userPreferences)}
${rememberedInfo}
${webSearchSection}
Reply (be modern, witty, cool, and appropriate; try to keep reply short but impactful):`;
    const result = await model.generateContent(prompt);
    let reply = (result.response && result.response.text()) || "i'm having a moment, try again.";
    if (reply.length > 1000) reply = reply.substring(0, 1000) + "...";
    // Update user interactions (if user_doc does not exist, insert new)
    if (!userDoc) {
      await dbInsert("user_data", { user_id: userId, username: "user", behavior: { interactions: 0 }, preferences: [] });
    }
    await dbUpdate("user_data", { user_id: userId }, { $inc: { "behavior.interactions": 1 }, $set: { username: userDoc?.username || "user" } });
    return reply;
  } catch (error) {
    advancedErrorHandler(error, "chatWithGemini");
    return "An error occurred while processing your request. Please try again later.";
  }
}

/********************************************************************
 * MAJOR SECTION 10: MOOD & PREFERENCE MANAGEMENT
 * 10.1: Functions to set mood, add/remove/list preferences
 ********************************************************************/
async function setMood(userId, mood) { // 10.1.1
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
async function setPreference(userId, newPreference, username) { // 10.1.2
  try {
    let userDoc = await dbFindOne("user_data", { user_id: userId });
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
async function removePreference(userId, indexToRemove) { // 10.1.3
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
async function listPreferences(userId) { // 10.1.4
  try {
    const userDoc = await dbFindOne("user_data", { user_id: userId });
    return userDoc?.preferences || [];
  } catch (error) {
    advancedErrorHandler(error, "listPreferences");
    return [];
  }
}

/********************************************************************
 * MAJOR SECTION 11: SLASH COMMANDS REGISTRATION
 * 11.1: Define all commands and register them using SlashCommandBuilder
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
  { name: "prefremove", description: "View and remove your preferences (with pagination)" },
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
          { name: "userdb", value: "userdb" },
          { name: "database", value: "database" }
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
      { type: 1, name: "channel", description: "Set an allowed channel for the bot to talk in" },
      { type: 1, name: "remove", description: "Remove a channel from the bot's allowed channels" }
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
  { name: "unremember", description: "Remove your stored personal info (interactive menu with pagination)" },
  {
    name: "meme",
    description: "Fetch a meme from Reddit (with fallbacks)",
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
// (The commands array above is used by the REST registration in Section 6)

/********************************************************************
 * MAJOR SECTION 12: INTERACTION HANDLERS (Slash, Buttons, Menus)
 * 12.1: Handle slash commands and interactive components including pagination.
 ********************************************************************/
client.on("interactionCreate", async (interaction) => { // 12.1.1
  try {
    // Owner-only check for debug commands
    if (interaction.commandName === "debug" && interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: "you can't do it lil bro 💀", ephemeral: true });
      return;
    }
    // If not in a guild and command isn’t debug/start, refuse DM usage.
    if (!interaction.guild && !["debug", "start"].includes(interaction.commandName)) {
      await interaction.reply({ content: "This command cannot be used in DMs.", ephemeral: true });
      return;
    }
    // For guild commands: check if chat is enabled.
    if (interaction.guild && interaction.commandName !== "start" && interaction.commandName !== "debug") {
      const settings = await getGuildSettings(interaction.guild.id);
      if (settings.chat_enabled !== 1) {
        await interaction.reply({ content: "start red first", ephemeral: true });
        return;
      }
    }
    // Handle slash commands
    if (interaction.isCommand()) {
      const { commandName } = interaction;
      if (commandName === "start") {
        const settings = await getGuildSettings(interaction.guild.id);
        if (settings.chat_enabled === 1) {
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
        await setGuildChat(interaction.guild.id, true);
        await interaction.reply({ content: getRandomElement([
          "alright, i'm awake and ready 🔥",
          "i'm back, let's roll.",
          "yoo, i'm online now.",
          "ready to chat, let's do this."
        ]), ephemeral: true });
      } else if (commandName === "stop") {
        await setGuildChat(interaction.guild.id, false);
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
        await interaction.reply({ content: `Continuous reply ${mode}d.`, ephemeral: true });
      } else if (commandName === "debug") {
        // Handle various debug actions (e.g., /debug log, /debug listusers, /debug userdb, /debug database)
        const action = interaction.options.getString("action");
        if (action === "log") {
          // Example: Send paginated log (10 rows per page)
          const logContent = fs.readFileSync("error.log", "utf8");
          const lines = logContent.trim().split("\n");
          const pageSize = 25;
          const totalPages = Math.ceil(lines.length / pageSize);
          const currentPage = 1;
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
          await interaction.reply({ content: logMessage, components: [buttons], ephemeral: true });
        }
        // ... (Other debug actions such as listusers, userdb, database, etc. with interactive pagination similar to the log pagination below)
        else if (action === "listusers") {
          const users = await dbFind("user_data", {});
          const pageSize = 10;
          const totalPages = Math.ceil(users.length / pageSize);
          const currentPage = 1;
          const start = (currentPage - 1) * pageSize;
          const pageUsers = users.slice(start, start + pageSize);
          const userList = pageUsers.map((r, index) => `${start + index + 1}. ${r.username} (${r.user_id})`).join("\n");
          const contentMsg = `**Users (Page ${currentPage} of ${totalPages}):**\n` + userList;
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
          await interaction.reply({ content: contentMsg, components: [buttons], ephemeral: true });
        }
        // Additional debug actions can be added here
        else {
          await interaction.reply({ content: "Debug action not recognized.", ephemeral: true });
        }
      } else if (commandName === "set") {
        // Server configuration subcommands (channel add/remove) handled here.
        if (interaction.options.getSubcommand() === "channel") {
          // Add channel to allowed channels
          const channelId = interaction.channel.id;
          const settings = await getGuildSettings(interaction.guild.id);
          const channels = settings.allowed_channels;
          if (!channels.includes(channelId)) channels.push(channelId);
          await updateGuildAllowedChannels(interaction.guild.id, channels);
          await interaction.reply({ content: `Channel ${channelId} added to allowed channels.`, ephemeral: true });
        } else if (interaction.options.getSubcommand() === "remove") {
          // Remove channel from allowed channels
          const channelId = interaction.channel.id;
          const settings = await getGuildSettings(interaction.guild.id);
          const channels = settings.allowed_channels.filter(id => id !== channelId);
          await updateGuildAllowedChannels(interaction.guild.id, channels);
          await interaction.reply({ content: `Channel ${channelId} removed from allowed channels.`, ephemeral: true });
        }
      } else if (commandName === "remember") {
        // Save personal info (name, birthday, etc.)
        const data = {
          name: interaction.options.getString("name"),
          birthday: interaction.options.getString("birthday"),
          gender: interaction.options.getString("gender"),
          dislikes: interaction.options.getString("dislikes"),
          likes: interaction.options.getString("likes"),
          about: interaction.options.getString("about")
        };
        await dbUpdate("user_remember", { user_id: interaction.user.id }, { $set: { ...data, user_id: interaction.user.id } }, { upsert: true });
        await interaction.reply({ content: "Your information has been remembered.", ephemeral: true });
      } else if (commandName === "unremember") {
        // Interactive menu to remove specific remembered info (pagination/select menu)
        const remembered = await dbFindOne("user_remember", { user_id: interaction.user.id });
        if (!remembered) {
          await interaction.reply({ content: "No remembered info found.", ephemeral: true });
          return;
        }
        // Build a selection menu with each field as an option
        const fields = ["name", "birthday", "gender", "dislikes", "likes", "about"];
        const options = fields.map(field => ({ label: field, value: field }));
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("unremember_select")
          .setPlaceholder("Select the field to remove")
          .addOptions(options);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: "Select which information to remove:", components: [row], ephemeral: true });
      } else if (commandName === "gif") {
        const keyword = interaction.options.getString("keyword") || "funny";
        const gifObj = await getRandomGif(keyword);
        await interaction.reply({ content: gifObj.url });
      } else if (commandName === "meme") {
        const keyword = interaction.options.getString("keyword") || "funny";
        const memeObj = await getRandomMeme(keyword);
        await interaction.reply({ content: memeObj.url });
        await storeMedia("meme", memeObj.url, memeObj.name);
      }
    }
    // Handle interactive component responses (select menus, buttons)
    else if (interaction.isSelectMenu()) {
      if (interaction.customId === "prefremove_select") {
        const index = parseInt(interaction.values[0], 10);
        const result = await removePreference(interaction.user.id, index);
        await interaction.update({ content: result.message, components: [] });
      } else if (interaction.customId === "unremember_select") {
        const field = interaction.values[0];
        // Remove only the selected field from remembered info
        await dbUpdate("user_remember", { user_id: interaction.user.id }, { $unset: { [field]: "" } });
        await interaction.update({ content: `Removed your ${field}.`, components: [] });
      }
    }
    else if (interaction.isButton()) {
      // Example: Log pagination buttons
      if (interaction.customId.startsWith("log_page_prev_") || interaction.customId.startsWith("log_page_next_")) {
        try {
          const parts = interaction.customId.split("_");
          const direction = parts[2];
          let currentPage = parseInt(parts[3], 10);
          const logContent = fs.readFileSync("error.log", "utf8");
          const lines = logContent.trim().split("\n");
          const pageSize = 25;
          const totalPages = Math.ceil(lines.length / pageSize);
          if (direction === "next") {
            currentPage = Math.min(currentPage + 1, totalPages);
          } else if (direction === "prev") {
            currentPage = Math.max(currentPage - 1, 1);
          }
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
      }
      else if (interaction.customId.startsWith("listusers_prev_") || interaction.customId.startsWith("listusers_next_")) {
        try {
          const parts = interaction.customId.split("_");
          let currentPage = parseInt(parts[2], 10);
          const users = await dbFind("user_data", {});
          const pageSize = 10;
          const totalPages = Math.ceil(users.length / pageSize);
          if (interaction.customId.startsWith("listusers_next_")) {
            currentPage = Math.min(currentPage + 1, totalPages);
          } else {
            currentPage = Math.max(currentPage - 1, 1);
          }
          const start = (currentPage - 1) * pageSize;
          const pageUsers = users.slice(start, start + pageSize);
          const userList = pageUsers.map((r, index) => `${start + index + 1}. ${r.username} (${r.user_id})`).join("\n");
          const contentMsg = `**Users (Page ${currentPage} of ${totalPages}):**\n` + userList;
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
          await interaction.update({ content: contentMsg, components: [buttons] });
        } catch (error) {
          advancedErrorHandler(error, "List Users Pagination");
          await interaction.reply({ content: "An error occurred while updating user list.", ephemeral: true });
        }
      }
    }
  } catch (error) {
    advancedErrorHandler(error, "Interaction Handler");
    if (!interaction.replied) {
      await interaction.reply({ content: "An error occurred while processing your interaction.", ephemeral: true });
    }
  }
});

/********************************************************************
 * MAJOR SECTION 13: MESSAGE HANDLER
 * 13.1: Handle incoming messages and trigger responses, including attachments OCR,
 * auto-reply logic, meme/gif trigger and chatWithGemini reply.
 ********************************************************************/
client.on("messageCreate", async (message) => { // 13.1
  try {
    // 13.2: Update last active channel.
    if (message.guild && message.channel.type === ChannelType.GuildText) {
      lastActiveChannel.set(message.guild.id, message.channel);
    }
    // 13.3: Process attachments for OCR if images are sent.
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType && attachment.contentType.startsWith("image/")) {
          const ocrResult = await performOCR(attachment.url);
          if (ocrResult) {
            // Append OCR text to message content for context.
            message.content += `\n[OCR]: ${ocrResult}`;
          }
        }
      }
    }
    if (!globalChatEnabled) return;
    // Insert chat message into database (MongoDB)
    await dbInsert("chat_messages", {
      discord_id: message.id,
      channel_id: message.channel.id,
      user: message.author.id,
      content: message.content,
      timestamp: new Date()
    });
    if (message.author.id === client.user.id) return;
    if (message.guild) {
      const settings = await getGuildSettings(message.guild.id);
      if (settings.chat_enabled !== 1) return;
      if (settings.allowed_channels.length > 0 && !settings.allowed_channels.includes(message.channel.id)) return;
    }
    // 13.4: Trigger meme/gif sending if keywords found.
    const triggers = ["meme", "funny", "gif"];
    if (triggers.some(t => message.content.toLowerCase().includes(t)) && Math.random() < 0.30) {
      const searchTerm = lastBotMessageContent ? lastBotMessageContent.split(" ").slice(0, 3).join(" ") : "funny";
      if (Math.random() < 0.5) {
        const memeObj = await getRandomMeme(searchTerm);
        try {
          await message.channel.send({ content: memeObj.url });
          await storeMedia("meme", memeObj.url, memeObj.name);
        } catch (err) {
          advancedErrorHandler(err, "Sending Meme");
        }
      } else {
        const gifObj = await getRandomGif(searchTerm);
        try {
          await message.channel.send({ content: gifObj.url });
          await storeMedia("gif", gifObj.url, gifObj.name);
        } catch (err) {
          advancedErrorHandler(err, "Sending Gif");
        }
      }
      return;
    }
    if (!shouldReply(message)) return;
    const replyContent = await chatWithGemini(message.author.id, message.content);
    if (replyContent === lastReply) return;
    lastReply = replyContent;
    try {
      const sentMsg = await message.channel.send(replyContent);
      lastBotMessageContent = replyContent;
      botMessageIds.add(sentMsg.id);
      setTimeout(() => botMessageIds.delete(sentMsg.id), 3600000);
    } catch (err) {
      advancedErrorHandler(err, "Sending Reply");
    }
  } catch (error) {
    advancedErrorHandler(error, "Message Handler");
  }
});

/********************************************************************
 * MAJOR SECTION 14: EXPRESS SERVER SETUP (FOR RENDER KEEP-ALIVE)
 ********************************************************************/
const app = express();
app.get("/", (req, res) => {
  res.send("Bot is running!");
});
app.listen(PORT, () => {
  console.log(`Express server is listening on port ${PORT}`);
});

client.login(DISCORD_TOKEN);
