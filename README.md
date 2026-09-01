# Discord Strike Bot

A prefix-based Discord staff strike and role-protection bot built with `discord.js`.

## Setup

1. Create a Discord application and bot in the Developer Portal.
2. Enable **Message Content Intent** and **Server Members Intent**.
3. Invite the bot with `Manage Roles`, `View Audit Log`, `Send Messages`, and `Embed Links`.
4. Put the bot role above every role it must remove or restore.
5. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
6. Run `npm start`.

The guild owner must first run `-setstaff @role`. Only the guild owner can change that role: run `-resetstaffrole` before configuring a replacement. Then configure logs with `-setlogs strike`, `-setlogs protected`, and `-setlogs main`.

All runtime data is stored in `data/guilds.json`, which is ignored by Git. Every bot response and log is sent as a compact colorless embed. Commands use the `-` prefix by default.

## Commands

Run `-commands` or `-cmds` for the interactive command dashboard. It contains moderation, protection, and owner-only command groups.

The dashboard shows six commands per page. Use the dropdown to switch groups and the Previous/Next buttons to browse without rerunning the command. Staff can use `-botclear` to remove up to 20 recent messages from themselves and this bot in the current channel; the bot needs `Manage Messages`.

Staff can use `-staffblacklist @user|role|ID <reason>` and `-rmstaffblacklist @user|role|ID <reason>`. A blacklisted user, or any member assigned a blacklisted role, cannot retain roles with Administrator, Ban Members, Kick Members, Moderate Members, or Move Members permissions.

Use `-staffblacklistlist` to review active blacklist entries and removed blacklist history, with six entries per page and button navigation.

## Important Discord limitation

Protection restoration depends on the bot’s role hierarchy and audit-log access. Discord does not expose the executor directly in `guildMemberUpdate`, so the bot restores protected roles whenever it detects they are missing. Keep the bot above protected roles and do not give it a role that outranks the server owner.
