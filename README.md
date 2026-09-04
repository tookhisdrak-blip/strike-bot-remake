# Discord Strike Bot

A prefix-based Discord staff strike and role-protection bot built with `discord.js`.

## Setup

1. Create a Discord application and bot in the Developer Portal.
2. Enable **Message Content Intent** and **Server Members Intent**.
3. Invite the bot with `Manage Roles`, `View Audit Log`, `Send Messages`, and `Embed Links`.
4. Put the bot role above every role it must remove or restore.
5. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
6. Run `npm start`.

The guild owner must first run `-setstaff @role`. Only the guild owner can change that role; running `-setstaff` again replaces the previous role. Then configure logs with `-setlogs strike`, `-setlogs protected`, and `-setlogs main`.

All runtime data is stored in `data/guilds.json` and `data/godmode.json`, which are ignored by Git. On Railway, attach a persistent volume mounted to the project's `data` directory; otherwise an instance replacement can discard local JSON files. Every bot response and log is sent as a compact colorless embed. Commands use the `-` prefix by default.

## Commands

Run `-help`, `-commands`, or `-cmds` for the interactive command dashboard. It contains moderation, protection, voice, configuration, and owner-only command groups.

The guild owner can run `-botsetup` to configure the bot-managed hierarchy. Before setup, the guild owner is the only user with bot management access. Admin identities receive all bot commands; Staff and Moderators receive only commands selected during setup. Roles and individual users are stored by ID.

Voice management is available through `-vc` actions including `follow`, `unfollow`, `chain`, `bring`, `inspect`, `godmode`, `ungodmode`, `muteall`, `unmuteall`, `dragall`, `voicehistory`, `forceownership`, and `voiceoverride`. `-stfu` and `-unstfu` provide persistent server-mute enforcement.

The dashboard shows six commands per page. Use the dropdown to switch groups and the Previous/Next buttons to browse without rerunning the command. Staff can use `-botclear` to remove up to 20 recent messages from themselves and this bot in the current channel; the bot needs `Manage Messages`.

Staff can use `-staffblacklist @user|role|ID <reason>` and `-rmstaffblacklist @user|role|ID <reason>`. A blacklisted user, or any member assigned a blacklisted role, cannot retain roles with Administrator, Ban Members, Kick Members, Moderate Members, or Move Members permissions.

Use `-staffblacklistlist` to review active blacklist entries and removed blacklist history, with six entries per page and button navigation.

The guild owner can use `-avatar <image URL>` and `-banner <image URL>` to update the bot profile. `-bio <text>` saves the requested bio text, but Discord currently does not provide a bot API for changing a bot's public profile bio.

## Important Discord limitation

Protection restoration depends on the bot’s role hierarchy and audit-log access. Discord does not expose the executor directly in `guildMemberUpdate`, so the bot restores protected roles whenever it detects they are missing. Keep the bot above protected roles and do not give it a role that outranks the server owner.
