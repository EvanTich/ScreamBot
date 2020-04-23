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
// config contains prefix, max_time, min_time
const config = require('./config.json');

const client = new Discord.Client();

// per server settings
/**
 * settings = {
 *  "id": {
 *   "toggled": boolean,        // toggled on by default
 *   "channel": VoiceChannel,   // voice channel, null means its not on a channel
 *   "members": string[]        // string array of user id's currently in the channel
 *  }
 * }
 */
let settings = {}; 
// end of per server settings


const { Readable } = require('stream');

const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
  }
}


function getRandomTime() {
    return Math.random() * (config.max_time - config.min_time) + config.min_time;
}

function leave(guildId) {
    settings[guildId].channel.leave();
    settings[guildId].channel = null;
}

function createOutputFile(user) {
    // use IDs instead of username cause some people have stupid emojis in their name
    const fileName = `./recordings/${user.id}.pcm`;
    let stream = fs.createWriteStream(fileName);

    // write the header of a wav file
    //stream.write(audioHeader);

    return stream;
}

function scream(conn, guildId, id, recursive = false) {
    let { members, channel } = settings[guildId];
    setTimeout(() => {

        conn.play(`./recordings/${members[Math.floor(Math.random() * members.length)]}.wav`);

        if(recursive && channel && channel.id == id)
            scream(conn, guildId, id, recursive);
    }, getRandomTime());
}

function dbLevel(file) {

}

/**
 * 
 * @param {string} id user id to try to replace
 * @param {string} guildId key is the user id, number is files max db level
 */
function replaceMaxAudioFile(id, guildId) {
    // replace max/id.wav with id.wav if id.wav has more volume than max/id.wav

    // max/id.wav volume is in wavs dictionary
    
}

function join(msg, mem) {
    if(settings[msg.guild.id].toggled && mem.voice.channel) {
        let obj = settings[mem.guild.id];
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
                    console.log('listening...')

                    const audio = conn.receiver.createStream(u, { mode: 'pcm' });
                    const outputStream = createOutputFile(u);

                    audio.pipe(outputStream);

                    audio.on('end', () => {
                        console.log('stopped listening...');
                        ffmpeg(`./recordings/${u.id}.pcm`)
                            .inputOptions(['-f s16le', '-ar 48k', '-ac 2'])
                            .output(`./recordings/${u.id}.wav`)
                            .on('end', () => {
                                console.log('formatted');
                            }).on('error', err => {
                                console.log(err);
                            }).run();

                        replaceMaxAudioFile(u.id, null);
                    });
                }
            });

            // initial members 
            obj.members = obj.channel.members.filter(member => !member.user.bot).map(member => member.user.id);

            // using debug strings to add/remove user id's to/from obj.members
            conn.on('debug', str => {
                if(str.startsWith('[WS] << ')) {
                    let { op, d: { user_id: userId } } = JSON.parse(str.slice(8));
                    if(op == 13) { // op = 13 -> disconnect
                        delete obj.members[obj.members.indexOf(userId)];
                    } else if(op == 12) { // op = 12 -> connect
                        obj.members.push(userId);
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
            "toggled": true,
            "channel": null,        // voice channel 
            "members": []           // string array of user id's currently in the channel
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
        }
    }
});

client.on('ready', () => {
    console.log('ready');
});

client.login(token);