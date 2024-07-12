const { Client, Intents, MessageEmbed } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
require('dotenv').config();

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS] });

let db;

const initDb = async () => {
  db = await open({
    filename: path.join(__dirname, 'bot_data.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      reported INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS user_links (
      user_id TEXT PRIMARY KEY,
      link_count INTEGER DEFAULT 0,
      last_reset DATE
    );
  `);
};

client.once('ready', async () => {
  await initDb();
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(resetLimits, 7 * 24 * 60 * 60 * 1000); // Reset limits every week
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const [command, ...args] = message.content.split(' ');

  if (command === '!addlink') {
    if (args.length !== 1) {
      return message.reply('Please provide a single URL.');
    }
    const url = args[0];
    await db.run('INSERT INTO links (url) VALUES (?)', [url]);
    message.reply(`Link ${url} added.`);
  }

  if (command === '!reportlink') {
    if (args.length !== 1) {
      return message.reply('Please provide a link ID.');
    }
    const linkId = parseInt(args[0], 10);
    await db.run('UPDATE links SET reported = reported + 1 WHERE id = ?', [linkId]);
    message.reply(`Link ${linkId} has been reported.`);
  }

  if (command === '!getlink') {
    const roleLimits = {
      'link access': 3,
      'level 10': 4,
      'level 25': 5,
      'level 50': 6,
    };

    const userRoles = message.member.roles.cache.map(role => role.name.toLowerCase());
    const maxLinks = Math.max(...userRoles.map(role => roleLimits[role] || 0), 0);

    const user = await db.get('SELECT * FROM user_links WHERE user_id = ?', [message.author.id]);

    if (user && user.link_count >= maxLinks) {
      return message.reply('You have reached your weekly limit for links.');
    }

    const link = await db.get('SELECT id, url FROM links WHERE reported < 3 ORDER BY RANDOM() LIMIT 1');

    if (!link) {
      return message.reply('No available links.');
    }

    const embed = new MessageEmbed()
      .setTitle("Here's your link!")
      .setDescription(link.url);

    await message.reply({ embeds: [embed] });

    if (user) {
      await db.run('UPDATE user_links SET link_count = link_count + 1 WHERE user_id = ?', [message.author.id]);
    } else {
      await db.run('INSERT INTO user_links (user_id, link_count, last_reset) VALUES (?, 1, ?)', [message.author.id, new Date().toISOString()]);
    }
  }

  if (command === '!reset' && message.member.permissions.has('ADMINISTRATOR')) {
    await resetLimits();
    message.reply('Link limits have been reset for everyone.');
  }
});

const resetLimits = async () => {
  await db.run('UPDATE user_links SET link_count = 0');
  console.log('Link limits reset for all users.');
};

client.login(process.env.DISCORD_TOKEN);
