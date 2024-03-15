import express from 'express';
import bodyParser from 'body-parser';
import EventEmitter from 'events';
import SpotifyWebApi from 'spotify-web-api-node';
import open from 'open';
import sleep from './sleep.mjs'

export default class SpotifyBeatDetector extends EventEmitter {
  constructor({clientId, clientSecret, redirectUri, audioDelay=0, fps=60, playbackWatchInterval=1000} = {}) {
    super();
    this.spotifyApi = new SpotifyWebApi({
      clientId,
      clientSecret,
      redirectUri,
    });
    this.playbackWatchInterval = playbackWatchInterval;
    this.fps = fps;
    this.audioDelay = audioDelay;

    this.frameInterval = 1000 / this.fps;
    this.previousFrameTime = null;
    this.playbackState = null;
    this.playbackStateRecTime = null;
    this.audioAnalysis = null;
  }

  async init() {
    this.app = express();
    this.app.use(bodyParser.urlencoded({ extended: true }));

    this.app.get('/login', (req, res) => this._redirectToSpotifyLogin(req, res));
    this.app.get('/api/v1/spotify-callback', async (req, res) => this._spotifyCallback(req, res));

    this.app.listen(3104, async () => {
      console.log('Please authorize Spotify: http://localhost:3104/login');
      await open('http://localhost:3104/login');
    });

    const authorizePromise = new Promise((resolve, reject) => {
      this.on('authorized', resolve);
    });
    await authorizePromise;
  }

  async _redirectToSpotifyLogin(req, res) {
    const authorizeURL = this.spotifyApi.createAuthorizeURL(['user-read-playback-state', 'user-read-currently-playing'], 'state');
    res.redirect(authorizeURL);
  }

  findClosestElement(elementType, index) {
    const elements = this.audioAnalysis[elementType];

    const element = elements[index];
    let closestElement = null;
    let minDifference = Infinity;

    for (const otherElement of elements) {
      const difference = Math.abs(element.start - otherElement.start);
      if (difference < minDifference && otherElement !== element) {
        minDifference = difference;
        closestElement = otherElement;
      }
    }

    return closestElement;
  }

  async _spotifyCallback(req, res) {
    const { code } = req.query;

    try {
      const data = await this.spotifyApi.authorizationCodeGrant(code);
      const { access_token, refresh_token } = data.body;

      // Set the access token on the API object
      this.spotifyApi.setAccessToken(access_token);
      this.spotifyApi.setRefreshToken(refresh_token);

      this._onConnectedToSpotify();

      res.send(`<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Spotify Authorizarion Successful</title>
          <script>window.close();</script>
        </head>
        <body>
          Authorization successful! You can close this tab now.
        </body>
        </html>
      `);
    } catch (error) {
      res.send('Authorization failed. Please try again.');
    }
  }

  async _onConnectedToSpotify() {
    this.emit('authorized', true);
    // Start listening to playback changes in background
    setInterval(this._spotifyPlaybackDataUpdate.bind(this), this.playbackWatchInterval);
    this.previousFrameTime = performance.now()-this.frameInterval;
    this._startFrameLoop(); // run in background
  }

  async _startFrameLoop() {
    while (true) {
      const frameStartTime = performance.now();
      
      const data = {
        //currentTime: frameStartTime,
        //previousFrameTime: this.previousFrameTime,
        isPlaying: this.playbackState?.body?.is_playing,
        playbackProgress: this.getAudiblePlaybackProgress(frameStartTime),
        previousProgress: this.getAudiblePlaybackProgress(this.previousFrameTime),
        audioAnalysis: this.audioAnalysis,
        //playbackState: this.playbackState
      };

      await this._onFrame(data);

      const frameEndTime = performance.now();
      const frameDuration = frameEndTime-frameStartTime;

      // Sleep for the remaining time until the next frame
      await sleep(this.frameInterval - frameDuration);

      this.previousFrameTime = frameStartTime; //performance.now();
    }
  }

  async _onFrame({isPlaying, playbackProgress, previousProgress, audioAnalysis}) {
    if (!isPlaying || !playbackProgress || !audioAnalysis) {
      return;
    }

    const userSeeked = playbackProgress < previousProgress;

    const { sections, segments, bars, beats, tatums } = audioAnalysis.body;
    const trackElementGroups = { sections, segments, bars, beats, tatums };

    const detectedElements = {};
    for (const [trackElementName, trackElementGroup] of Object.entries(trackElementGroups)) {
      for (const [index, trackElement] of trackElementGroup.entries()) {
        const itemTime = trackElement.start*1000;
        if ((itemTime > previousProgress || userSeeked) && playbackProgress >= itemTime && playbackProgress < itemTime+this.frameInterval) {
          detectedElements[trackElementName.slice(0, -1)] = { ...trackElement, index };
          break;
        }
      }
    }

    for (const trackElementName of Object.keys(detectedElements)) {
      this.emit(trackElementName, {...detectedElements, playbackProgress});
    }

    this.previousFrameEnd = performance.now();
  }

  findClosestElement(elementType, index) {
    const { sections, segments, bars, beats, tatums } = this.audioAnalysis.body;
    const elementGroups = { sections, segments, bars, beats, tatums };

    if (!elementGroups.hasOwnProperty(elementType)) {
      return null;
    }

    const elementGroup = elementGroups[elementType];
    const element = elementGroup[index];

    let closestElements = {
      section: null,
      segment: null,
      bar: null,
      beat: null,
      tatum: null
    };

    let minDifferences = {
      section: Infinity,
      segment: Infinity,
      bar: Infinity,
      beat: Infinity,
      tatum: Infinity
    };

    // Find closest elements
    for (const [groupName, group] of Object.entries(elementGroups)) {
      for (const [idx, el] of group.entries()) {
        if (idx !== index) {
          const difference = Math.abs(element.start + element.duration - el.start);
          if (difference < minDifferences[groupName]) {
            minDifferences[groupName] = difference;
            closestElements[groupName] = el;
          }
        }
      }
    }

    return closestElements;
  }

  getPlaybackProgress(time, {state, recTime} = {}) {
    const playbackState = state || this.playbackState;
    if (!playbackState?.body?.progress_ms) {
      return null;
    }
    return playbackState.body.progress_ms + ((time || performance.now()) - (recTime || this.playbackStateRecTime));
  }

  getAudiblePlaybackProgress(time, stateObj) {
    return this.getPlaybackProgress(time, stateObj) + this.playbackStateServerLatency/2 + this.audioDelay;
  }

  async _spotifyPlaybackDataUpdate() {
    const timeBeforeReq = performance.now();
    const newPlaybackState = await this.spotifyApi.getMyCurrentPlaybackState();
    const now = performance.now();
    const newServerLatency = now - timeBeforeReq;

    const predictedProgress = this.getPlaybackProgress(now, {state: this.playbackState, recTime: this.playbackStateRecTime});
    const currentProgress = this.getPlaybackProgress(now, {state: newPlaybackState, recTime: now});
    const playbackSeeked = Math.abs(currentProgress-predictedProgress) > Math.max(newServerLatency, this.playbackStateServerLatency);
    const latencyIsBetter = newServerLatency < this.playbackStateServerLatency;
    const currentTrackId = newPlaybackState?.body?.item?.id;
    const previousTrackId = this.playbackState?.body?.item?.id;
    const trackChanged = currentTrackId !== previousTrackId;


    // if (latencyIsBetter) {
    //   console.log(`Latency: ${newServerLatency} `);
    // }

    // if (playbackSeeked && newPlaybackState?.body?.is_playing) {
    //   console.log(`Seek detected`);
    //   console.log(`Math.abs(currentProgress-predictedProgress) - Math.abs(${currentProgress}-${predictedProgress}) = ${Math.abs(currentProgress-predictedProgress)}`);
    //   console.log(`Math.max(newServerLatency, this.playbackStateServerLatency) - Math.max(${newServerLatency}, ${this.playbackStateServerLatency}) = ${Math.max(newServerLatency, this.playbackStateServerLatency)}`);
    // }

    if (latencyIsBetter || playbackSeeked || trackChanged) {
      this.playbackState = newPlaybackState;
      this.playbackStateServerLatency = newServerLatency;
      this.playbackStateRecTime = now;
      this.emit("playback-state-update", newPlaybackState);
    }
    
    if (trackChanged && currentTrackId) {
      this.audioAnalysis = await this.spotifyApi.getAudioAnalysisForTrack(currentTrackId);
      this.emit("track-changed", { playbackState: this.playbackState, audioAnalysis: this.audioAnalysis });
    }
  }
}