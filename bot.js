const { Client, Intents, MessageEmbed } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
require('dotenv').config();

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS] });

let db;

const initDb = async () => {
  db = await open({
    filename: path.join(__dirname, process.env.DATABASE_PATH || 'bot_data.db'),
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
    CREATE TABLE IF NOT EXISTS server_settings (
      guild_id TEXT PRIMARY KEY,
      admin_role_id TEXT
    );
  `);
};

client.once('ready', async () => {
  await initDb();
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(resetLimits, 7 * 24 * 60 * 60 * 1000); // Reset limits every week
  registerCommands();
});

const commands = [
  {
    name: 'addlink',
    description: 'Adds a new link to the database',
    options: [
      {
        name: 'url',
        type: 'STRING',
        description: 'The URL of the link',
        required: true
      }
    ]
  },
  {
    name: 'reportlink',
    description: 'Reports a link',
    options: [
      {
        name: 'id',
        type: 'INTEGER',
        description: 'The ID of the link',
        required: true
      }
    ]
  },
  {
    name: 'getlink',
    description: 'Gets a link based on your role and limit'
  },
  {
    name: 'reset',
    description: 'Resets the link limits for everyone (Admin only)'
  },
  {
    name: 'resetuser',
    description: 'Resets the link limit for a specific user (Admin only)',
    options: [
      {
        name: 'user',
        type: 'USER',
        description: 'The user to reset',
        required: true
      }
    ]
  },
  {
    name: 'setadminrole',
    description: 'Sets the admin role for the server',
    options: [
      {
        name: 'role',
        type: 'ROLE',
        description: 'The role to set as admin role',
        required: true
      }
    ]
  }
];

const registerCommands = async () => {
  const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
};

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'addlink') {
    const url = options.getString('url');
    await db.run('INSERT INTO links (url) VALUES (?)', [url]);
    await interaction.reply(`Link ${url} added.`);
  } else if (commandName === 'reportlink') {
    const linkId = options.getInteger('id');
    await db.run('UPDATE links SET reported = reported + 1 WHERE id = ?', [linkId]);
    await interaction.reply(`Link ${linkId} has been reported.`);
  } else if (commandName === 'getlink') {
    const roleLimits = {
      'link access': 3,
      'level 10': 4,
      'level 25': 5,
      'level 50': 6,
    };

    const userRoles = interaction.member.roles.cache.map(role => role.name.toLowerCase());
    const maxLinks = Math.max(...userRoles.map(role => roleLimits[role] || 0), 0);

    const user = await db.get('SELECT * FROM user_links WHERE user_id = ?', [interaction.user.id]);

    if (user && user.link_count >= maxLinks) {
      await interaction.reply('You have reached your weekly limit for links.');
      return;
    }

    const link = await db.get('SELECT id, url FROM links WHERE reported < 3 ORDER BY RANDOM() LIMIT 1');

    if (!link) {
      await interaction.reply('No available links.');
      return;
    }

    const embed = new MessageEmbed()
      .setTitle("Here's your link!")
      .setDescription(link.url);

    await interaction.reply({ embeds: [embed] });

    if (user) {
      await db.run('UPDATE user_links SET link_count = link_count + 1 WHERE user_id = ?', [interaction.user.id]);
    } else {
      await db.run('INSERT INTO user_links (user_id, link_count, last_reset) VALUES (?, 1, ?)', [interaction.user.id, new Date().toISOString()]);
    }
  } else if (commandName === 'reset' && await isAdmin(interaction)) {
    await resetLimits();
    await interaction.reply('Link limits have been reset for everyone.');
  } else if (commandName === 'resetuser' && await isAdmin(interaction)) {
    const user = options.getUser('user');
    await db.run('UPDATE user_links SET link_count = 0 WHERE user_id = ?', [user.id]);
    await interaction.reply(`Link limit has been reset for ${user.tag}.`);
  } else if (commandName === 'setadminrole' && await isAdmin(interaction)) {
    const role = options.getRole('role');
    await db.run('INSERT OR REPLACE INTO server_settings (guild_id, admin_role_id) VALUES (?, ?)', [interaction.guild.id, role.id]);
    await interaction.reply(`Admin role has been set to ${role.name}.`);
  }
});

const isAdmin = async (interaction) => {
  const settings = await db.get('SELECT admin_role_id FROM server_settings WHERE guild_id = ?', [interaction.guild.id]);
  const adminRoleId = settings ? settings.admin_role_id : null;
  return adminRoleId && interaction.member.roles.cache.has(adminRoleId);
};

const resetLimits = async () => {
  await db.run('UPDATE user_links SET link_count = 0');
  console.log('Link limits reset for all users.');
};

client.login(process.env.DISCORD_TOKEN);
