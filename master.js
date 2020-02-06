const mediasoup = require('mediasoup-client');
const socketClient = require('socket.io-client');
const socketPromise = require('./lib/socket.io-promise').promise;
const config = require('./config');

const hostname = window.location.hostname;

let device;
let socket;
let producer;

const $ = document.querySelector.bind(document);
const btnConnect = $('#btn_connect');
const btnPublish = $('#btn_publish');
const txtConnection = $('#connection_status');
const txtPublish = $('#pub_status');
const audioInputSelect = $('#audioSource');
const videoSelect = $('#videoSource');
const selectors = [audioInputSelect, videoSelect];


btnConnect.addEventListener('click', connect);
btnPublish.addEventListener('click', publish);

// Get Media Device Stuff //
// ====================== //
function gotDevices(deviceInfos) {
  // Handles being called several times to update labels. Preserve values.
  const values = selectors.map(select => select.value);
  selectors.forEach(select => {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }
  });
  for (let i = 0; i !== deviceInfos.length; ++i) {
    const deviceInfo = deviceInfos[i];
    const option = document.createElement('option');
    option.value = deviceInfo.deviceId;
    if (deviceInfo.kind === 'audioinput') {
      option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1}`;
      audioInputSelect.appendChild(option);
    } else if (deviceInfo.kind === 'videoinput') {
      option.text = deviceInfo.label || `camera ${videoSelect.length + 1}`;
      videoSelect.appendChild(option);
    } else {
      console.log('Some other kind of source/device: ', deviceInfo);
    }
  }
  selectors.forEach((select, selectorIndex) => {
    if (Array.prototype.slice.call(select.childNodes).some(n => n.value === values[selectorIndex])) {
      select.value = values[selectorIndex];
    }
  });
}

navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);

function handleError(error) {
  console.log('navigator.MediaDevices.getUserMedia error: ', error.message, error.name);
}


// Actual SFU WebRTC Stuff //
// ======================= //
async function connect () {
  btnConnect.disabled = true;
  txtConnection.innerHTML = 'Connecting...';

  const opts = {
    path: '/server',
    transports: ['websocket'],
  };

  const serverUrl = `https://${hostname}:${config.listenPort}`;
  socket = socketClient(serverUrl, opts);
  socket.request = socketPromise(socket);

  socket.on('connect', async () => {
    console.log('connected');
    txtConnection.innerHTML = 'Connected';
    btnPublish.disabled = false;

    const data = await socket.request('getRouterRtpCapabilities');
    await loadDevice(data);
    console.log('RTP Capabilities', device.rtpCapabilities);
  });

  socket.on('disconnect', () => {
    console.log('disconnected');
    txtConnection.innerHTML = 'Disconnected';
    btnConnect.disabled = false;
    btnPublish.disabled = true;
  });

  socket.on('connect_error', (error) => {
    console.error('could not connect to %s%s (%s)', serverUrl, opts.path, error.message);
    txtConnection.innerHTML = 'Connection failed';
    btnConnect.disabled = false;
  });

  socket.on('newProducer', () => {
    console.log('newProducer');
  });
}

async function loadDevice (routerRtpCapabilities) {
  try {
    device = new mediasoup.Device();
  } catch (error) {
    if (error.name === 'UnsupportedError') {
      console.warn('browser not supported');
    }
  }
  console.log('device:', device.handlerName);
  await device.load({ routerRtpCapabilities });
}

async function publish () {
  console.log('publishing...');
  txtPublish.innerHTML = 'publishing...';
  btnPublish.disabled = true;
  const data = await socket.request('createProducerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
  });
  const transport = await connectProducerTransport(data);
  console.log('producer transport', transport);

  try {
    await startWebcam(transport);
  } catch (err) {
    txtPublish.innerHTML = 'failed';
    return;
  }
  txtPublish.innerHTML = 'published';
}

async function connectProducerTransport (transportInfo) {
  const transport = device.createSendTransport(transportInfo);
  transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    socket.request('connectProducerTransport', { dtlsParameters })
      .then(callback)
      .catch(errback);
  });

  transport.on(
    'produce', ({ kind, rtpParameters }, callback, errback) => {
      socket.request('produce', {
        transportId: transport.id,
        kind,
        rtpParameters,
      })
        .then(callback)
        .catch(errback);
    });

  return transport;
}


async function startWebcam (transport) {
  console.info('start webcam...');

  if (!device.canProduce('video')) {
    console.error('cannot produce video');
    return;
  }

  let stream;
  try {
    const audioSource = audioInputSelect.value;
    const videoSource = videoSelect.value;
    const constraints = {
    audio: {deviceId: audioSource ? {exact: audioSource} : undefined},
    video: {deviceId: videoSource ? {exact: videoSource} : undefined}
  };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error('starting webcam failed,', err.message);
    throw err;
  }
  const track = stream.getVideoTracks()[0];
  document.querySelector('#local_video').srcObject = stream;
  producer = await transport.produce({ track });
}
