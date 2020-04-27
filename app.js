/**
 * THE Scream Bot
 */

const Discord = require('discord.js');
const fs = require('fs');

const { token } = require('./token.json');
const config = require('./config.json');

// process args
const DEBUG = process.argv.includes('--debug');       // prints debug logs if true
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
 * @typedef  {Object}       Settings
 * @property {boolean}      toggled      used primarily for disabling the bot
 * @property {VoiceChannel} channel      current voice channel for this server, null means its not on a channel
 * @property {string[]}     members      user id's currently in the channel
 * @property {number}       min_time     min time until scream
 * @property {number}       max_time     max time until scream
 * @property {boolean}      silent_start should the bot join silently?
 * 
 * @type {Object.<string, Settings>} key is the guild id
 */
let settings = {}; 

/**
 * @type {Object.<string, number>} 
 *      key   - user id
 *      value - max dB measurement from wav file
 */
let dBMeasurements = {};

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
    settings[guildId].members = [];
}

function rms(data, start, length) {
    let buffer = Buffer.alloc(2); // for reading little endian int16 s

    let sum = 0;
    // data is composed of samples
    // 2 channels per sample, 2 bytes per channel
    // left audio sample is the same as the right audio sample
    for(let i = 0; i < length; i++) {
        buffer[0] = data[i * 4 + start];
        buffer[1] = data[i * 4 + start + 1];
        sum += buffer.readInt16LE() * buffer.readInt16LE();
    }

    return Math.sqrt(sum / length)
}

function toDecibels(rms) {
    return rms != 0 ? 20 * Math.log10(rms) : 0;
}

/**
 * Only writes to disk once.
 * @param {ReadableStream} rawPCM 
 * @param {string} userId 
 */
function createWAV(rawPCM, userId) {
    let start = Date.now();
    let data = [];

    let index = 0;
    let dBMax = -1; // max db measurement of rms+dB calculations
    rawPCM.on('data', chunk => {
        data.push(...chunk);

        // do rms calculation when there are enough samples
        while(data.length - index >= config.samples_per_rms) {
            let dB = toDecibels(rms(data, index, config.samples_per_rms));
            if(dB >= dBMax) {
                dBMax = dB;
            }

            index += 4 * config.samples_per_rms;
        }
    });

    rawPCM.on('end', () => {
        if(!(userId in dBMeasurements) || dBMax >= dBMeasurements[userId]) {
            let write = fs.createWriteStream(`./recordings/${userId}.wav`);
            write.write(HEADERS.TOP);
            write.write(sizeBuffer(36 + data.length));
            write.write(HEADERS.MIDDLE);
            write.write(sizeBuffer(data.length));
            write.end(Buffer.from(data));

            write.on('finish', () => {
                dBMeasurements[userId] = dBMax;
                log('new clip for ', userId, ' at ', dBMax, ' dB');
                if(DURATION) console.log('time taken: ', data.length / 4 / 48000 - (Date.now() - start));
            });
        }
    });
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
            log('connection');

            // (User, Speaking) => {}
            conn.on('speaking', (u, speaking) => {
                if(u && !u.bot && speaking.bitfield != 0) {
                    const raw = conn.receiver.createStream(u, { mode: 'pcm' });
                    createWAV(raw, u.id);
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
                            if(!user.bot && !obj.members.includes(d.user_id))
                                obj.members.push(d.user_id);
                            
                            log(obj.members);
                        });
                    }
                }
            });

            if(obj.silent_start) {
                conn.play(new Silence(), { type: 'opus' });
            } else {
                // clips supplied by some nice friends :)
                conn.play(`./recordings/start${Math.floor(Math.random() * 2)}.m4a`, { volume: 1 });
            }

            // randomly play files
            scream(conn, mem.guild.id, obj.channel.id, true);

        }).catch(console.log);
    }
}

function initServer() {
    return {
        "toggled": true,
        "channel": null,
        "members": [],
        "min_time": config.default_min_time,
        "max_time": config.default_max_time,
        "silent_start": true
    };
}

/**
 * Initializes the file dB measurements.
 */
function init() {
    fs.readdir('./recordings', (err, files) => {
        for(let file of files) {
            // make sure file is a user wav file
            let matches;
            if(matches = file.match(/[0-9]*\.wav/g)) {
                let read = fs.createReadStream(`./recordings/${file}`);
                let dBMax = -1;
                let index = 0;
                let data = [];
                read.on('data', chunk => {
                    data.push(...chunk);

                    // do rms calculation when there are enough samples
                    while(data.length - index >= config.samples_per_rms) {
                        let dB = toDecibels(rms(data, index, config.samples_per_rms));
                        if(dB >= dBMax) {
                            dBMax = dB;
                        }
                    
                        index += 4 * config.samples_per_rms;
                    }
                });

                read.on('end', () => {
                    dBMeasurements[matches[0].slice(0, -4)] = dBMax;
                    log(dBMeasurements);
                })
            }
        }
    });
}

init();

client.on('message', msg => {
    if(!(msg.guild.id in settings)) {
        settings[msg.guild.id] = initServer();
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
                if(msg.guild) {
                    join(msg, msg.member);
                } else {
                    msg.channel.send('You have to be in a guild to use this command!');
                }
                
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
            case 'silent':
                settings[msg.guild.id].silent_start = !settings[msg.guild.id].silent_start;
                msg.channel.send(`Silent Start is ${settings[msg.guild.id].silent_start ? 'ON' : 'OFF'}!`);
                break;
            case 'delete': 
                fs.unlink(`./recordings/${msg.author.id}.wav`, err => {
                    if(!err) {
                        log('deleted voice clip of ', msg.author.id);
                        msg.channel.send('Successfully deleted voice clip on file!');
                        dBMeasurements[msg.author.id] = -1;
                    }
                });
                break;
            case 'db':
                if(dBMeasurements[msg.author.id]) {
                    msg.channel.send(`The voice clip I have has a measure as ${dBMeasurements[msg.author.id]} "dB" max`);
                } else {
                    msg.channel.send('I don\'t have a voice clip of you on file.');
                }
                break;
        }
    }
});

client.on('ready', () => {
    log('ready');
});

client.login(token);