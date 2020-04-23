/**
 * Repeats the last thing anybody said at random intervals.
 * Too hilarious to not keep.
 * Code came from Scream Bot.
 */

const Discord = require('discord.js');
const fs = require('fs');

const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const { token } = require('./token.json');
const config = require('./config.json');

const client = new Discord.Client();

/**
 * settings = {
 *  "guild.id": {
 *   "toggled": boolean,        // toggled on by default
 *   "channel": VoiceChannel,   // voice channel, null means its not on a channel
 *   "members": string[],        // string array of user id's currently in the channel
 *   "min_time": number,
 *   "max_time": number
 *  }
 * }
 */
let settings = {}; 


// fix for discord.js problems from https://github.com/discordjs/discord.js/issues/2929
const { Readable } = require('stream');

const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
  }
}
// end of fix


function getRandomTime(guildId) {
    return Math.random() * (settings[guildId].max_time - settings[guildId].min_time) + settings[guildId].min_time;
}

function leave(guildId) {
    settings[guildId].channel.leave();
    settings[guildId].channel = null;
}

function createOutputFile(user) {
    return fs.createWriteStream(`./recordings/${user.id}.pcm`);
}

function scream(conn, guildId, id, recursive = false) {
    let { members, channel } = settings[guildId];
    setTimeout(() => {

        conn.play(`./recordings/${members[Math.floor(Math.random() * members.length)]}.wav`);

        if(recursive && channel && channel.id == id)
            scream(conn, guildId, id, recursive);
    }, getRandomTime(guildId));
}

function join(msg, mem) {
    let obj = settings[mem.guild.id];
    if(obj.toggled && mem.voice.channel) {
        if(obj.channel && obj.channel.id == mem.voice.channel.id) {
            msg.channel.send('I\'m already connected!');
            return;
        }

        obj.channel = mem.voice.channel;
        obj.channel.join().then(conn => {
            console.log('connection');

            // (User, Speaking) => {}
            conn.on('speaking', (u, speaking) => {
                if(speaking.bitfield != 0) {
                    const audio = conn.receiver.createStream(u, { mode: 'pcm' });
                    const outputStream = createOutputFile(u);

                    audio.pipe(outputStream);

                    audio.on('end', () => {
                        ffmpeg(`./recordings/${u.id}.pcm`)
                            .inputOptions(['-f s16le', '-ar 48k', '-ac 2'])
                            .output(`./recordings/${u.id}.wav`)
                            .on('end', () => {
                                //console.log('formatted');
                            }).on('error', err => {
                                console.log(err);
                            }).run();
                    });
                }
            });

            // initial members 
            obj.members = obj.channel.members.filter(member => !member.user.bot).map(member => member.user.id);

            // using debug strings to add/remove user id's to/from obj.members
            conn.on('debug', str => {
                if(str.startsWith('[WS] << ')) {
                    let { op, d } = JSON.parse(str.slice(8));
                    if(op == 13) { // op = 13 -> disconnect
                        delete obj.members[obj.members.indexOf(d.user_id)];
                    } else if(op == 12) { // op = 12 -> connect
                        obj.members.push(d.user_id);
                    }
                }
            });

            conn.play(new Silence(), { type: 'opus' });

            // randomly play files
            scream(conn, mem.guild.id, obj.channel.id, true);

        }).catch(console.log);
    }
}

client.on('message', msg => {
    if(!(msg.guild.id in settings)) {
        settings[msg.guild.id] = {
            "toggled": true,                        // Toggled?
            "channel": null,                        // voice channel 
            "members": [],                          // string array of user id's currently in the channel
            "min_time": config.default_min_time,    // 
            "max_time": config.default_max_time,    //
        };
    }

    if(msg.content.startsWith(config.prefix)) {
        let [, command, ...args] = msg.content.split(' ');
        switch(command) {
            case 'leave':
                leave(msg.guild.id);
                break;
            case 'toggle':
                settings[msg.guild.id].toggled = !settings[msg.guild.id].toggled;
                if(!settings[msg.guild.id].toggled)
                    leave(msg.guild.id);
                msg.channel.send(`Toggled ${settings[msg.guild.id].toggled ? 'ON' : 'OFF'}!`);
                break;
            case 'join':
                join(msg, msg.member);
                break;
            case 'min': {
                let time = parseInt(args[0]) * 1000;
                if(time >= config.minimal_time) {
                    settings[msg.guild.id].min_time = time;
                }
                break;
            }
            case 'max': {
                let time = parseInt(args[0]) * 1000;
                if(time >= settings[msg.guild.id].min_time) {
                    settings[msg.guild.id].max_time = time;
                }
                break;
            }
        }
    }
});

client.on('ready', () => {
    console.log('ready');
});

client.login(token);