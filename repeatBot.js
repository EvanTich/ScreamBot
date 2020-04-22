/**
 * Repeats the last thing anybody said at random intervals.
 * Too hilarious to not keep.
 * Code came from Scream Bot.
 */


const Discord = require('discord.js');
const fs = require('fs');

const { token } = require('./token.json');
// config contains prefix, max_time, min_time
const config = require('./config.json');

const client = new Discord.Client();

// per server settings
let toggled = true;     // toggled on by default
let channel;            // null means its not on a channel
// end of per server settings

// set up buffer with header information
// PCM audio, 48k audio sampling frequency, 2 audio channels
// http://soundfile.sapp.org/doc/WaveFormat/ really helps
const audioHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x46, 0x67, 0x02, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6D, 0x74, 0x20, 
    0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x80, 0xBB, 0x00, 0x00, 0x00, 0xEE, 0x02, 0x00, 
    0x04, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x67, 0x02, 0x00
]);


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

function leave() {
    channel.leave();
    channel = null;
}

function createOutputFile(user) {
    // use IDs instead of username cause some people have stupid emojis in their name
    const fileName = `./recordings/${user.id}.wav`;
    let stream = fs.createWriteStream(fileName);

    // write the header of a wav file
    stream.write(audioHeader);

    return stream;
}

function scream(conn, members, id, recursive = false) {
    setTimeout(() => {

        conn.play(`./recordings/${members[Math.floor(Math.random() * members.length)]}.wav`);

        if(recursive && channel && channel.id == id)
            scream(conn, members, id, recursive);
    }, getRandomTime());
}

function dbLevel(file) {

}

/**
 * 
 * @param {string} id user id to try to replace
 * @param {Object.<string, number>} wavs key is the user id, number is files max db level
 */
function replaceMaxAudioFile(id, wavs) {
    // replace max/id.wav with id.wav if id.wav has more volume than max/id.wav

    // max/id.wav volume is in wavs dictionary
    console.log('TODO');
}

function join(msg, mem) {
    if(toggled && mem.voice.channel) {
        if(channel && channel.id == mem.voice.channel.id) {
            msg.channel.send('I\'m already connected!');
            return;
        }

        channel = mem.voice.channel;
        channel.join().then(conn => {
            console.log('connection');

            // (User, Speaking) => {}
            conn.on('speaking', (u, speaking) => {
                if(speaking.bitfield != 0) {

                    const audio = conn.receiver.createStream(u, { mode: 'pcm' });
                    const outputStream = createOutputFile(u);

                    audio.pipe(outputStream);

                    audio.on('end', () => {
                        replaceMaxAudioFile(u.id, null);
                        
                    });
                }
            });

            conn.on('debug', console.log);

            /* https://www.youtube.com/watch?v=XdQPPh5eA_8
                start0 - Jack
                start1 - Cam
            */
            //conn.play(`./recordings/start${Math.floor(Math.random() * 2)}.m4a`, { volume: 1 });
            conn.play(new Silence(), { type: 'opus' });

            // randomly play a file
            const members = channel.members.filter(member => !member.user.bot).map(member => member.user.id);
            // TODO: members can join and leave, be sure to add/remove members
            console.log(members);
            scream(conn, members, channel.id, true);

        }).catch(console.log);
    }
}

client.on('message', msg => {
    if(msg.content.startsWith(config.prefix)) {
        let [, command, ...args] = msg.content.split(' ');
        switch(command) {
            case 'leave':
                leave();
                break;
            case 'toggle':
                toggled = !toggled;
                if(!toggled)
                    leave();
                msg.channel.send(`Toggled ${toggled ? 'ON' : 'OFF'}!`);
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