# Discord Strike Bot

A prefix-based Discord staff strike and role-protection bot built with `discord.js`.

## Setup

1. Create a Discord application and bot in the Developer Portal.
2. Enable **Message Content Intent** and **Server Members Intent**.
3. Invite the bot with `Manage Roles`, `View Audit Log`, `Send Messages`, and `Embed Links`.
4. Put the bot role above every role it must remove or restore.
5. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
6. Run `npm start`.

The guild owner must first run `-setstaff @role`, then configure logs with `-setlogs strike`, `-setlogs protected`, and `-setlogs main`.

All runtime data is stored in `data/guilds.json`, which is ignored by Git. Every bot response and log is sent as a compact colorless embed. Commands use the `-` prefix by default.

## Commands

Run `-commands` or `-cmds` for the interactive command dashboard. It contains moderation, protection, and owner-only command groups.

## Important Discord limitation

Protection restoration depends on the bot’s role hierarchy and audit-log access. Discord does not expose the executor directly in `guildMemberUpdate`, so the bot restores protected roles whenever it detects they are missing. Keep the bot above protected roles and do not give it a role that outranks the server owner.
