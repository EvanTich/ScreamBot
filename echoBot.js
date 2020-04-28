/**
 * Repeats the last thing anybody said at random intervals.
 * Too hilarious to not keep.
 * Code originally came from Scream Bot as a nice side effect of testing.
 */

const Discord = require('discord.js');
const fs = require('fs');

// const ffmpegPath = require('ffmpeg-static');
// const ffmpeg = require('fluent-ffmpeg');
// ffmpeg.setFfmpegPath(ffmpegPath);

const { token } = require('./token.json');
const config = require('./config.json');

// process args
const DEBUG = process.argv.includes('--debug');       // prints debug logs if true
const TYPE = process.argv.includes('--2');            // uses createWAV2 instead of createWAV if true
const DURATION = process.argv.includes('--duration'); // prints how long it takes to convert to wav
// end of process args

const client = new Discord.Client();

// fix for discord.js problems from https://github.com/discordjs/discord.js/issues/2929
const { Readable } = require('stream');

const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

class Silence extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
  }
}
// end of fix

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

/**
 * Contains main header for RIFF WAVE files.
 * PCM audio, 48k audio sampling frequency, 2 audio channels
 * http://soundfile.sapp.org/doc/WaveFormat/ is helpful for understanding it.
 * @property {Buffer} TOP    bytes for 'RIFF', ChunkSize goes afterwards
 * @property {Buffer} MIDDLE bytes for rest of WAVE format, Subchunk2Size goes afterwards
 */
const HEADERS = {
    TOP: Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
    MIDDLE: Buffer.from([
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6D, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 
        0x80, 0xBB, 0x00, 0x00, 0x00, 0xEE, 0x02, 0x00, 0x04, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61])
};

function log(...strs) {
    if(DEBUG) console.log(...strs);
}

function sizeBuffer(size) {
    let buf = Buffer.alloc(4);
    buf.writeUInt32LE(size);
    return buf;
}

function getRandomTime(guildId) {
    return Math.random() * (settings[guildId].max_time - settings[guildId].min_time) + settings[guildId].min_time;
}

function leave(guildId) {
    log('disconnect');
    settings[guildId].channel.leave();
    settings[guildId].channel = null;
}

/**
 * Only writes to disk once.
 * @param {ReadableStream} rawPCM 
 * @param {string} userId 
 */
function createWAV(rawPCM, userId) {
    let start = Date.now();
    let data = [];
    rawPCM.on('data', chunk => {
        data.push(...chunk);
    });

    rawPCM.on('end', () => {
        let write = fs.createWriteStream(`./recordings/echo/${userId}.wav`);
        write.write(HEADERS.TOP);
        write.write(sizeBuffer(36 + data.length));
        write.write(HEADERS.MIDDLE);
        write.write(sizeBuffer(data.length));
        write.end(Buffer.from(data));

        write.on('finish', () => {
            if(DURATION) console.log('time taken: ', (Date.now() - start) - (data.length / 192));
        });
    });
}

/**
 * Writes to disk twice, reads once.
 * @param {ReadableStream} rawPCM 
 * @param {string} userId 
 */
function createWAV2(rawPCM, userId) {
    let start = Date.now();

    let pcmPath = `./recordings/${userId}.pcm`;
    let origWriteStream = fs.createWriteStream(pcmPath);

    rawPCM.pipe(origWriteStream);

    rawPCM.on('end', () => {
        fs.stat(pcmPath, (err, stats) => {
            let bytes = stats.size;
    
            let write = fs.createWriteStream(`./recordings/echo/${userId}.wav`);
            write.write(HEADERS.TOP);
            write.write(sizeBuffer(36 + bytes));
            write.write(HEADERS.MIDDLE);
            write.write(sizeBuffer(bytes));
            let read = fs.createReadStream(pcmPath);
            read.pipe(write);
    
            read.on('end', () => {
                write.end();
                write.on('finish', () => {
                    if(DURATION) console.log('time taken: ', (Date.now() - start) - (data.length / 192));
                });
            });
        });
    });
}

function scream(conn, guildId, id, recursive = false) {
    let { members, channel } = settings[guildId];
    setTimeout(() => {

        conn.play(`./recordings/echo/${members[Math.floor(Math.random() * members.length)]}.wav`);

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
            log('connection');

            // (User, Speaking) => {}
            conn.on('speaking', (u, speaking) => {
                if(u && !u.bot && speaking.bitfield != 0) {
                    const raw = conn.receiver.createStream(u, { mode: 'pcm' });

                    if(TYPE) createWAV2(raw, u.id);
                    else     createWAV(raw, u.id);
                }
            });

            // initial members 
            obj.members = obj.channel.members.filter(member => !member.user.bot).map(member => member.user.id);

            // using debug strings to add/remove user id's to/from obj.members
            // TODO: test further, problems may arise
            conn.on('debug', str => {
                if(str.startsWith('[WS] << ')) {
                    let { op, d } = JSON.parse(str.slice(8));
                    if(op == 13) { // op = 13 -> disconnect
                        let i = obj.members.indexOf(d.user_id);
                        if(i != -1) {
                            obj.members.splice(i, 1);
                        }
                        
                        log(obj.members);
                        if(obj.members.length == 0) {
                            leave(mem.guild.id);
                        }
                    } else if(op == 12) { // op = 12 -> connect
                        client.users.fetch(d.user_id).then(user => {
                            if(!user.bot)
                                obj.members.push(d.user_id);
                            
                            log(obj.members);
                        });
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
            "max_time": config.default_max_time     //
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
    log('ready');
});

client.login(token);