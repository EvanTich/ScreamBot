const fs = require('fs');

const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Contains main header for 
 * @property {Buffer} TOP    bytes for 'RIFF', ChunkSize goes afterwards
 * @property {Buffer} MIDDLE bytes for rest of WAVE format, Subchunk2Size goes afterwards
 */
const HEADERS = {
    TOP: Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
    MIDDLE: Buffer.from([
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6D, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 
        0x80, 0xBB, 0x00, 0x00, 0x00, 0xEE, 0x02, 0x00, 0x04, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61])
};

function sizeBuffer(size) {
    let buf = Buffer.alloc(4);
    buf.writeUInt32LE(size);
    return buf;
}

const testFile = './recordings/203281664699269121.pcm';

/**
 * Using raw pcm data
 */
function testCustom1(times, raw) {
    let start = Date.now();
    let filePath = './recordings/test/custom1.wav';

    let data = [];
    raw.on('data', chunk => {
        data.push(...chunk);
    });

    raw.on('end', () => {
        let write = fs.createWriteStream(filePath);
        write.write(HEADERS.TOP);
        write.write(sizeBuffer(36 + data.length));
        write.write(HEADERS.MIDDLE);
        write.write(sizeBuffer(data.length));
        write.end(Buffer.from(data));

        write.on('finish', () => {
            console.log('custom1: ', Date.now() - start);
        });
    });
}

/**
 * Using file data
 */
function testCustom2(times, raw) {
    let start = Date.now();

    // mock original file saving
    let origFilePath = './recordings/test/orig_custom2.pcm';
    let origWriteStream = fs.createWriteStream(origFilePath);

    raw.pipe(origWriteStream);

    raw.on('end', () => {
        fs.stat(origFilePath, (err, stats) => {
            let bytes = stats.size;
            let filePath = './recordings/test/custom2.wav';
    
            let write = fs.createWriteStream(filePath);
            write.write(HEADERS.TOP);
            write.write(sizeBuffer(36 + bytes));
            write.write(HEADERS.MIDDLE);
            write.write(sizeBuffer(bytes));
            let read = fs.createReadStream(testFile);
            read.pipe(write);

            read.on('end', () => {
                write.end();
                write.on('finish', () => {
                    console.log('custom2: ', Date.now() - start);
                    // times.push(Date.now() - start);
                });
            });
        });
    });
}


function testFFMPEG(times, raw) {
    let start = Date.now();
    ffmpeg(testFile)
        .inputOptions(['-f s16le', '-ar 48k', '-ac 2'])
        .output('./recordings/test/ffmpeg.wav')
        .on('end', () => {
            console.log('ffmpeg: ', Date.now() - start);
            // times.push(Date.now() - start)
        }).on('error', err => {
            console.log(err);
        }).run();
}

// const NUM = 100;

let tests = [testFFMPEG, testCustom1, testCustom2];
// let times = [[], [], []];
for(let i = 0; i < tests.length; i++) {
    // for(let j = 0; j < NUM; j++) {
        let raw = fs.createReadStream(testFile);
        tests[i](times[i], raw);
    // }
}

// setTimeout(() => {
//     for(let i = 0; i < tests.length; i++) {
//         console.log('All done? ', times[i].length == NUM);
//         console.log(times[i].reduce((a, b) => a + b, 0) / NUM); // average
//     }
// }, 5000);

