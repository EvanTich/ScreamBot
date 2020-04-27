import matplotlib.pyplot as plt
import scipy.io.wavfile as wav
import numpy as np

# get data from wav file, convert to dB, plot
# note: wav file is PCM audio, 48k audio sampling frequency, 2 audio channels

FILE = './recordings/test/LOUD2.wav'

sample_rate, data = wav.read(FILE)
duration = data.shape[0] / sample_rate

print(f"size: {data.shape[0]}")
print(f"duration: {duration} s")

# gotta love some list comprehensions
# divided before adding because overflow is possible
# elements are int16 but I don't know how to convert to it
data = [int(data[i, 0] / 2 + data[i, 1] / 2) for i in range(data.shape[0])]


import time, math
now = lambda: math.floor(time.time() * 1000)

# calculate root mean square on the given data
# from https://dsp.stackexchange.com/questions/2951/loudness-of-pcm-stream/2953#2953
# rms = Energy, similar enough to loudness
# also convert to dB
def rms(data, start = 0, n = len(data)):
    """Calculates root mean square to get Energy of data."""
    s = 0
    for i in range(start, start + n):
        s += data[i] * data[i]
    return math.sqrt(s / n)

def to_dB(rms):
    if rms != 0:
        return 20 * math.log(rms, 10)
    return 0

# using length of window to measure
# from https://dsp.stackexchange.com/questions/46147/how-to-get-the-volume-level-from-pcm-audio-data
# ends up being 1920 samples per 400ms duration with 48k sampling frequency
def rms_dur(data, duration, sample_rate):
    """Calculates an array of a number of rms values from the given data."""
    count = int(duration * sample_rate) # number of samples per "duration"
    n = int(len(data) / sample_rate / duration)
    return [to_dB(rms(data, i * count, count)) for i in range(n)]


start_time = now()
momentary = rms_dur(data, .04, sample_rate)
print(f"momentary: {now() - start_time} ms")

start_time = now()
short_term_time = .5
short_term = rms_dur(data, short_term_time, sample_rate)
print(f"short term: {now() - start_time} ms")

start_time = now()
integrated = to_dB(rms(data))
print(f"integrated: {now() - start_time} ms")

# graph it, damn it
plt.plot(np.linspace(0, duration, len(momentary)), momentary, label="Momentary")
plt.plot([i * short_term_time for i in range(len(short_term))], short_term, label="Short term")
plt.plot([0, duration], [integrated, integrated], label="Integrated")
plt.legend()

plt.xlabel("Time (s)")
plt.ylabel("Decibels")
plt.grid()
plt.show()

# for reference: https://www.chem.purdue.edu/chemsafety/Training/PPETrain/dblevels.htm