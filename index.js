require('dotenv').config();
const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Locked Image Pair System
const imagePairs = [
    {
        theme: "Golden Retriever vs. Labrador",
        crewImage: "https://rengood1.github.io/imposter-game-discord/images/dog_crew.jpg", 
        impostorImage: "https://rengood1.github.io/imposter-game-discord/images/dog_impostor.jpg" 
    },

    {
        theme: "Granny Smith Apple vs. Green Pear",
        crewImage: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6", 
        impostorImage: "https://images.unsplash.com/photo-1514733670123-ac38a761ef3e" 
    }
];

client.once(Events.ClientReady, (c) => {
    console.log(`🤖 Logged in as ${c.user.tag}! Ready to play Find the Impostor.`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || message.content !== '!impostor') return;

    const channel = message.channel;
    const host = message.author;
    
    // Auto-add the host to the players list right away!
    const players = new Set([host.id]);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('join_game')
            .setLabel('🎮 Join Game')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('start_game')
            .setLabel('🚀 Start Game (Host Only)')
            .setStyle(ButtonStyle.Primary)
    );

    const lobbyMessage = await channel.send({
        content: `🕵️ **Find the Impostor Game Lobby!**\nHost (<@${host.id}>) has automatically joined! Others can click **Join Game** below.\nPlayers joined: **${players.size}**`,
        components: [row]
    });

    const collector = lobbyMessage.createMessageComponentCollector({ time: 120000 });
    const secretAssignments = new Map();

    collector.on('collect', async interaction => {
        if (interaction.customId === 'join_game') {
            if (players.has(interaction.user.id)) {
                return interaction.reply({ content: 'You are already in the game!', ephemeral: true });
            }
            players.add(interaction.user.id);
            await interaction.reply({ content: '✅ You have joined the game!', ephemeral: true });
            
            await lobbyMessage.edit({
                content: `🕵️ **Find the Impostor Game Lobby!**\nHost (<@${host.id}>) is in. Others can click **Join Game**.\nPlayers joined: **${players.size}**`
            });
        } 
        
        else if (interaction.customId === 'start_game') {
            if (interaction.user.id !== host.id) {
                return interaction.reply({ content: '❌ Only the host who started the command can launch the game!', ephemeral: true });
            }

            if (players.size < 1) { 
                return interaction.reply({ content: '❌ Need at least 1 player to start!', ephemeral: true });
            }

            collector.stop('started');

            const disabledRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(row.components[0]).setDisabled(true),
                ButtonBuilder.from(row.components[1]).setDisabled(true)
            );
            await interaction.update({ content: `🚀 **Game is starting with ${players.size} players! Check your secret assignments below!**`, components: [disabledRow] });

            const playerArray = [];
            for (const userId of players) {
                const user = await client.users.fetch(userId);
                playerArray.push(user);
            }

            // --- GAME LOOP ---
            const pair = imagePairs[Math.floor(Math.random() * imagePairs.length)];
            const impostorIndex = Math.floor(Math.random() * playerArray.length);
            const impostor = playerArray[impostorIndex];

            for (let i = 0; i < playerArray.length; i++) {
                const player = playerArray[i];
                const isImpostor = (i === impostorIndex);
                
                secretAssignments.set(player.id, {
                    theme: pair.theme,
                    image: isImpostor ? pair.impostorImage : pair.crewImage,
                    isImpostor: isImpostor
                });
            }

            const secretRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('reveal_secret')
                    .setLabel('🔍 View My Secret Image')
                    .setStyle(ButtonStyle.Secondary)
            );

            await channel.send({
                content: `🔒 **Roles & Image Pairs assigned!** Click the button below to see your secret image:`,
                components: [secretRow]
            });

            // Shuffle turn order
            const shuffledPlayers = [...playerArray].sort(() => Math.random() - 0.5);
            const orderText = shuffledPlayers.map((p, index) => `${index + 1}. <@${p.id}>`).join(' -> ');
            
            await channel.send(`🎲 **Randomized Turn Order:**\n${orderText}\n\n*Player #1, type your 1-word clue now!*`);

            // Run Clue Phase
            for (const player of shuffledPlayers) {
                await channel.send(`👉 Your turn, <@${player.id}>! Drop your 1-word clue:`);

                const turnFilter = response => response.author.id === player.id;
                try {
                    const collectedClues = await channel.awaitMessages({ filter: turnFilter, max: 1, time: 30000, errors: ['time'] });
                    const clueMsg = collectedClues.first();
                    await clueMsg.react('✅');
                    await channel.send(`💬 **<@${player.id}>** said: *${clueMsg.content}*`);
                } catch (err) {
                    await channel.send(`⏰ <@${player.id}> ran out of time!`);
                }
            }

            // --- VOTING PHASE ---
            await channel.send(`🔍 **Clue phase complete!** Time to vote on who the Impostor is.`);

            // Create vote buttons for each player
            const voteRow = new ActionRowBuilder();
            playerArray.forEach((p, idx) => {
                voteRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`vote_${p.id}`)
                        .setLabel(p.username)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            const voteMessage = await channel.send({
                content: `🗳️ **VOTING TIME:** Click the button matching who you think the Impostor is!`,
                components: [voteRow]
            });

            const votes = new Map(); // voterId -> votedForId
            const voteCollector = voteMessage.createMessageComponentCollector({ time: 30000 });

            voteCollector.on('collect', async i => {
                const votedForId = i.customId.replace('vote_', '');
                votes.set(i.user.id, votedForId);
                await i.reply({ content: `✅ Vote recorded for <@${votedForId}>!`, ephemeral: true });
            });

            voteCollector.on('end', async () => {
                // Tally votes
                const tally = {};
                for (const votedId of votes.values()) {
                    tally[votedId] = (tally[votedId] || 0) + 1;
                }

                let maxVotes = 0;
                let suspectedId = null;
                for (const [id, count] of Object.entries(tally)) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        suspectedId = id;
                    }
                }

                let resultText = `🏁 **Voting Results!**\n`;
                if (!suspectedId) {
                    resultText += `No votes were cast! `;
                } else {
                    resultText += `The group voted for <@${suspectedId}>!\n`;
                }

                resultText += `✨ **The real Impostor was:** <@${impostor.id}> (${impostor.username})`;
                await channel.send(resultText);
            });
        }
    });

    // Handle secret viewing
    client.on(Events.InteractionCreate, async secretInteraction => {
        if (!secretInteraction.isButton() || secretInteraction.customId !== 'reveal_secret') return;

        const assignment = secretAssignments.get(secretInteraction.user.id);
        if (!assignment) {
            return secretInteraction.reply({ content: '❌ You are not part of this active game session!', ephemeral: true });
        }

        await secretInteraction.reply({
            content: `🤫 **Your Secret Assignment (${assignment.theme}):**\nHere is your image. Study it carefully and prepare your 1-word clue! 👇\n${assignment.image}`,
            ephemeral: true
        });
    });
});

client.login(process.env.DISCORD_TOKEN);