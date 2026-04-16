// State
let config = {
  sounds: [],
  inputDeviceId: 'default',
  virtualDeviceId: 'default',
  monitorDeviceId: 'default',
  monitorMuted: false,
  micVolume: 1,
  boardVolume: 0.8
};

// Web Audio API Setup
let audioCtx;
let virtualDestination;
let monitorDestination;
let micGain;
let boardGain;
let virtualOutputEl;
let monitorOutputEl;
let currentMicStream = null;
let currentDiscordStream = null;
let discordRecorder = null;
let isGlobalRecording = false;
let globalRecordChunks = [];
let wavesurfer = null;
let wsRegion = null;

// DOM Elements
const soundsGrid = document.getElementById('soundsGrid');
const addSoundBtn = document.getElementById('addSoundBtn');
const soundFormOverlay = document.getElementById('soundFormOverlay');
const cancelSoundBtn = document.getElementById('cancelSoundBtn');
const saveSoundBtn = document.getElementById('saveSoundBtn');
const pickFileBtn = document.getElementById('pickFileBtn');
const recordMicBtn = document.getElementById('recordMicBtn');
const filePathDisplay = document.getElementById('filePathDisplay');
const soundNameInput = document.getElementById('soundNameInput');
const shortcutInput = document.getElementById('shortcutInput');

// Discord & Workflow Elements
const discordDeviceSelect = document.getElementById('discordDevice');
const discordRecordShortcutInput = document.getElementById('discordRecordShortcutInput');
const globalRecIndicator = document.getElementById('globalRecIndicator');

// Trimmer Elements
const trimmerOverlay = document.getElementById('trimmerOverlay');
const trimmerPlayPauseBtn = document.getElementById('trimmerPlayPauseBtn');
const trimmerNameInput = document.getElementById('trimmerNameInput');
const trimmerCancelBtn = document.getElementById('trimmerCancelBtn');
const trimmerSaveBtn = document.getElementById('trimmerSaveBtn');
const trimmerDuration = document.getElementById('trimmerDuration');
let trimmerBlob = null;

const themeToggleBtn = document.getElementById('themeToggleBtn');

const inputDeviceSelect = document.getElementById('inputDevice');
const outputVirtualDeviceSelect = document.getElementById('outputVirtualDevice');
const outputMonitorDeviceSelect = document.getElementById('outputMonitorDevice');
const micVolumeSlider = document.getElementById('micVolume');
const boardVolumeSlider = document.getElementById('boardVolume');
const muteMonitorCheck = document.getElementById('muteMonitorCheck');
const nvidiaLink = document.getElementById('nvidiaLink');
const micVolText = document.getElementById('micVolText');
const boardVolText = document.getElementById('boardVolText');

let pendingFilePath = null;
let editingSoundId = null;

let mediaRecorder = null;
let recordedChunks = [];

// Initialize System
async function init() {
  setStatus('Initialisation du moteur audio...');
  initAudioEngine();
  
  setStatus('Chargement de la configuration...');
  const loadedConfig = await window.electronAPI.loadConfig();
  if (loadedConfig) {
    config = { ...config, ...loadedConfig };
  }

  // Set sliders and texts
  micVolumeSlider.value = config.micVolume;
  boardVolumeSlider.value = config.boardVolume;
  micGain.gain.value = config.micVolume;
  boardGain.gain.value = config.boardVolume;
  micVolText.textContent = Math.round(config.micVolume * 100) + '%';
  boardVolText.textContent = Math.round(config.boardVolume * 100) + '%';

  await populateDeviceSelects();

  // Restore selections
  if (config.inputDeviceId) inputDeviceSelect.value = config.inputDeviceId;
  if (config.discordDeviceId) discordDeviceSelect.value = config.discordDeviceId;
  if (config.virtualDeviceId) outputVirtualDeviceSelect.value = config.virtualDeviceId;
  if (config.monitorDeviceId) outputMonitorDeviceSelect.value = config.monitorDeviceId;

  if (config.discordRecordShortcut) {
    discordRecordShortcutInput.value = config.discordRecordShortcut;
    window.electronAPI.registerShortcut('discord-record-shortcut', config.discordRecordShortcut);
  }

  // Restore states
  if (config.colorSilver) document.body.classList.add('color-silver');
  if (config.uiMinimal) document.body.classList.add('ui-minimal');

  // Set Mute Monitor state
  if (monitorOutputEl) monitorOutputEl.muted = config.monitorMuted;
  muteMonitorCheck.checked = config.monitorMuted;

  // Render sounds
  renderSounds();
  
  // Apply routing
  await applyRouting();
  
  updateWorkflowStatus();
  
  // Register shortcuts via IPC
  registerAllShortcuts();

  setupEventListeners();
  
  setStatus('Prêt');
}

function initAudioEngine() {
  // We recreate context on user interaction if needed, Chromium policy.
  audioCtx = new AudioContext({ latencyHint: 'interactive' });
  
  virtualDestination = audioCtx.createMediaStreamDestination();
  monitorDestination = audioCtx.createMediaStreamDestination();
  
  micGain = audioCtx.createGain();
  boardGain = audioCtx.createGain();
  discordGain = audioCtx.createGain();
  
  // Route Mic ONLY to Virtual
  micGain.connect(virtualDestination);
  
  // Route Soundboard to BOTH
  boardGain.connect(virtualDestination);
  boardGain.connect(monitorDestination);
  
  // Route Discord to MONITOR ONLY
  discordGain.connect(monitorDestination);
  
  // Setup HTML Audio Elements to play the streams to specific devices
  virtualOutputEl = new Audio();
  virtualOutputEl.autoplay = true;
  virtualOutputEl.srcObject = virtualDestination.stream;
  
  monitorOutputEl = new Audio();
  monitorOutputEl.autoplay = true;
  monitorOutputEl.srcObject = monitorDestination.stream;
}

// Device Routing
async function populateDeviceSelects() {
  await navigator.mediaDevices.getUserMedia({ audio: true }); // Request permission
  const devices = await navigator.mediaDevices.enumerateDevices();
  
  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

  const populate = (select, list, allowNone = false) => {
    select.innerHTML = allowNone ? '<option value="">Sans/None</option>' : '';
    list.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Device ${device.deviceId.substring(0, 5)}`;
      select.appendChild(option);
    });
  };

  populate(inputDeviceSelect, audioInputs, true);
  populate(discordDeviceSelect, audioInputs, true);
  populate(outputVirtualDeviceSelect, audioOutputs, false);
  populate(outputMonitorDeviceSelect, audioOutputs, true);
}

async function applyRouting() {
  // Apply sinks
  try {
    if (config.virtualDeviceId) {
      if (typeof virtualOutputEl.setSinkId === 'function') {
        await virtualOutputEl.setSinkId(config.virtualDeviceId);
      }
    }
    if (config.monitorDeviceId) {
      if (typeof monitorOutputEl.setSinkId === 'function') {
        await monitorOutputEl.setSinkId(config.monitorDeviceId);
      }
    }
  } catch (err) {
    console.error('Failed to set sink ID:', err);
    setStatus('Erreur: Routage Sortie');
  }

  // Apply Mic
  try {
    if (currentMicStream) {
      currentMicStream.getTracks().forEach(t => t.stop());
    }
    
    if (config.inputDeviceId) {
      currentMicStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: config.inputDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      });
      const micSource = audioCtx.createMediaStreamSource(currentMicStream);
      
      // Mono conversion for Focusrite (takes left channel and centers it)
      const splitter = audioCtx.createChannelSplitter(2);
      const merger = audioCtx.createChannelMerger(2);
      micSource.connect(splitter);
      try {
        splitter.connect(merger, 0, 0); // L to L
        splitter.connect(merger, 0, 1); // L to R
        merger.connect(micGain);
      } catch(err) {
        micSource.connect(micGain);
      }
    }
  } catch (err) {
    console.error('Failed to capture mic:', err);
    setStatus('Erreur: Capturer Micro');
  }

  // Apply Discord
  try {
    if (currentDiscordStream) {
      currentDiscordStream.getTracks().forEach(t => t.stop());
      currentDiscordStream = null;
    }
    
    if (config.discordDeviceId) {
      currentDiscordStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: config.discordDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
      });
      const discordSource = audioCtx.createMediaStreamSource(currentDiscordStream);
      discordSource.connect(discordGain);
    }
  } catch (err) {
    console.error('Failed to capture discord:', err);
  }
}

// Audio Playback
function playSound(audioPath, soundId) {
  const audio = new Audio();
  audio.src = `file://${audioPath.replace(/\\/g, '/')}`;
  
  // Route track directly to BoardGain instead of default output
  const source = audioCtx.createMediaElementSource(audio);
  source.connect(boardGain);
  
  audio.play().catch(e => console.error(e));
  
  // Highlight UI
  const card = document.getElementById(`sound-${soundId}`);
  if (card) {
    card.classList.add('playing');
    audio.onended = () => card.classList.remove('playing');
  }
}

window.electronAPI.onShortcutTriggered((soundId) => {
  if (soundId === 'discord-record-shortcut') {
    toggleGlobalDiscordRecord();
    return;
  }
  const sound = config.sounds.find(s => s.id === soundId);
  if (sound) {
    playSound(sound.filePath, sound.id);
  }
});

function toggleGlobalDiscordRecord() {
  if (!currentDiscordStream) {
    console.error("Aucun flux Discord actif");
    return;
  }
  
  if (isGlobalRecording) {
    discordRecorder.stop();
  } else {
    globalRecordChunks = [];
    discordRecorder = new MediaRecorder(currentDiscordStream, { mimeType: 'audio/webm' });
    discordRecorder.ondataavailable = e => {
      if (e.data.size > 0) globalRecordChunks.push(e.data);
    };
    discordRecorder.onstop = async () => {
      isGlobalRecording = false;
      globalRecIndicator.classList.add('hidden');
      
      const webmBlob = new Blob(globalRecordChunks, { type: 'audio/webm' });
      const arrayBuffer = await webmBlob.arrayBuffer();
      
      try {
        const offlineCtx = new AudioContext();
        const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
        const wavArrayBuffer = audioBufferToWav(audioBuffer);
        const wavBlob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
        
        trimmerBlob = wavBlob;
        openTrimmerModal(wavBlob);
      } catch (err) {
        console.error("Erreur de décodage raw vers WAV :", err);
        trimmerBlob = webmBlob;
        openTrimmerModal(webmBlob);
      }
    };
    
    discordRecorder.start();
    isGlobalRecording = true;
    globalRecIndicator.classList.remove('hidden');
  }
}

async function openTrimmerModal(blob) {
  trimmerOverlay.classList.remove('hidden');
  trimmerDuration.textContent = 'Chargement...';
  trimmerNameInput.value = '';
  
  if (wavesurfer) {
    wavesurfer.destroy();
  }
  
  const isSilver = document.body.classList.contains('color-silver');

  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: isSilver ? 'rgba(0, 0, 0, 0.2)' : 'rgba(56, 189, 248, 0.5)',
    progressColor: isSilver ? 'rgba(0, 0, 0, 0.8)' : 'rgba(56, 189, 248, 1)',
    cursorColor: isSilver ? '#000000' : '#ffffff',
    barWidth: 2,
    barRadius: 2,
    cursorWidth: 1,
    height: 100,
    barGap: 1
  });

  if (config.monitorDeviceId) {
    wavesurfer.setSinkId(config.monitorDeviceId).catch(console.error);
  }

  let wsRegions;
  // If WaveSurfer Regions is loaded successfully
  if (window.WaveSurfer && window.WaveSurfer.Regions) {
    wsRegions = wavesurfer.registerPlugin(WaveSurfer.Regions.create());
  } else if (window.WaveSurferRegions) {
    wsRegions = wavesurfer.registerPlugin(window.WaveSurferRegions.create());
  }

  wavesurfer.loadBlob(blob);
  
  wavesurfer.on('ready', () => {
    trimmerDuration.textContent = `Durée brute: ${wavesurfer.getDuration().toFixed(1)}s`;
    if (wsRegions) {
      wsRegion = wsRegions.addRegion({
        start: 0,
        end: Math.min(wavesurfer.getDuration(), 5),
        color: isSilver ? 'rgba(0, 0, 0, 0.1)' : 'rgba(16, 185, 129, 0.3)',
        resize: true,
        drag: true
      });
    }
  });

  wavesurfer.on('timeupdate', (currentTime) => {
    if (wsRegion && wavesurfer.isPlaying() && currentTime >= wsRegion.end) {
      wavesurfer.pause();
      wavesurfer.setTime(wsRegion.start);
    }
  });

  trimmerPlayPauseBtn.onclick = () => {
    if (wsRegion) {
      if (wavesurfer.isPlaying()) {
        wavesurfer.pause();
      } else {
        wavesurfer.setTime(wsRegion.start);
        wavesurfer.play();
      }
    } else {
      wavesurfer.playPause();
    }
  };

  trimmerCancelBtn.onclick = () => {
    trimmerOverlay.classList.add('hidden');
    if (wavesurfer) wavesurfer.destroy();
    wavesurfer = null;
  };
  
  trimmerSaveBtn.onclick = async () => {
    if (!trimmerNameInput.value) {
      alert("Veuillez donner un nom au Snippet.");
      return;
    }
    
    trimmerSaveBtn.textContent = "Traitement en cours...";
    trimmerSaveBtn.disabled = true;
    
    const start = wsRegion ? wsRegion.start : 0;
    const end = wsRegion ? wsRegion.end : wavesurfer.getDuration();
    
    try {
      const arrayBuffer = await trimmerBlob.arrayBuffer();
      // On recree context juste pour decode
      const offlineCtx = new AudioContext();
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
      
      const frameStart = Math.floor(start * audioBuffer.sampleRate);
      const frameEnd = Math.floor(end * audioBuffer.sampleRate);
      const frameCount = frameEnd - frameStart;
      
      const slicedBuffer = offlineCtx.createBuffer(
        audioBuffer.numberOfChannels,
        frameCount,
        audioBuffer.sampleRate
      );
      
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        const channelData = audioBuffer.getChannelData(i);
        const slicedData = slicedBuffer.getChannelData(i);
        for (let j = 0; j < frameCount; j++) {
          slicedData[j] = channelData[frameStart + j];
        }
      }
      
      const wavArrayBuffer = audioBufferToWav(slicedBuffer);
      
      // Need ipc call
      const savedPath = await window.electronAPI.saveRecordedSnippet(wavArrayBuffer);
      
      const newSound = {
        id: Date.now().toString(),
        name: trimmerNameInput.value,
        filePath: savedPath,
        shortcut: ''
      };
      
      config.sounds.push(newSound);
      saveConfig();
      renderSounds();
      
      trimmerOverlay.classList.add('hidden');
    } catch(err) {
      console.error(err);
      alert("Erreur lors de la sauvegarde : " + err.message);
    } finally {
      trimmerSaveBtn.textContent = "Sauvegarder le Snippet";
      trimmerSaveBtn.disabled = false;
    }
  };
}

// UI Event Listeners
function setupEventListeners() {
  // Audio context resume on first interaction
  document.body.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }, { once: true });

  const toggleColorBtn = document.getElementById('toggleColorBtn');
  if (toggleColorBtn) {
    toggleColorBtn.addEventListener('click', () => {
      document.body.classList.toggle('color-silver');
      config.colorSilver = document.body.classList.contains('color-silver');
      saveConfig();
    });
  }

  const toggleUIBtn = document.getElementById('toggleUIBtn');
  const toggleUIMainBtn = document.getElementById('toggleUIMainBtn');
  
  function toggleUI() {
    document.body.classList.toggle('ui-minimal');
    config.uiMinimal = document.body.classList.contains('ui-minimal');
    saveConfig();
  }

  if (toggleUIBtn) toggleUIBtn.addEventListener('click', toggleUI);
  if (toggleUIMainBtn) toggleUIMainBtn.addEventListener('click', toggleUI);

  // Settings
  inputDeviceSelect.addEventListener('change', async (e) => {
    config.inputDeviceId = e.target.value;
    await applyRouting();
    updateWorkflowStatus();
    saveConfig();
  });
  
  outputVirtualDeviceSelect.addEventListener('change', async (e) => {
    config.virtualDeviceId = e.target.value;
    await applyRouting();
    updateWorkflowStatus();
    saveConfig();
  });
  
  outputMonitorDeviceSelect.addEventListener('change', async (e) => {
    config.monitorDeviceId = e.target.value;
    await applyRouting();
    saveConfig();
  });

  discordDeviceSelect.addEventListener('change', async (e) => {
    config.discordDeviceId = e.target.value;
    await applyRouting();
    updateWorkflowStatus(); // Discord routing might affect workflow visually later
    saveConfig();
  });

  discordRecordShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Escape') {
      discordRecordShortcutInput.value = '';
      config.discordRecordShortcut = '';
      window.electronAPI.unregisterShortcut('discord-record-shortcut');
      saveConfig();
      return;
    }
    
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    let keys = [];
    if (e.ctrlKey) keys.push('CommandOrControl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Super');

    let key = e.key;
    if (key === 'Dead' || key === 'Unidentified') return;
    
    // Electron specific mappings
    const keyMap = {
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Escape': 'Esc'
    };
    if (keyMap[key]) {
      key = keyMap[key];
    }
    
    if (e.code.startsWith('Numpad')) {
      if (e.code.length === 7 && e.code >= 'Numpad0' && e.code <= 'Numpad9') {
        key = 'num' + e.code[6];
      } else {
        switch(e.code) {
          case 'NumpadAdd': key = 'numadd'; break;
          case 'NumpadSubtract': key = 'numsub'; break;
          case 'NumpadMultiply': key = 'nummult'; break;
          case 'NumpadDivide': key = 'numdiv'; break;
          case 'NumpadDecimal': key = 'numdec'; break;
        }
      }
    } else if (key.length === 1 && key >= 'a' && key <= 'z') {
      key = key.toUpperCase();
    } else if (e.code === 'Space') {
      key = 'Space';
    }
    
    keys.push(key);
    const macroStr = keys.join('+');
    discordRecordShortcutInput.value = macroStr;
    config.discordRecordShortcut = macroStr;
    
    window.electronAPI.registerShortcut('discord-record-shortcut', macroStr);
    saveConfig();
  });

  micVolumeSlider.addEventListener('input', (e) => {
    config.micVolume = parseFloat(e.target.value);
    micGain.gain.value = config.micVolume;
    micVolText.textContent = Math.round(config.micVolume * 100) + '%';
    saveConfig();
  });

  boardVolumeSlider.addEventListener('input', (e) => {
    config.boardVolume = parseFloat(e.target.value);
    boardGain.gain.value = config.boardVolume;
    boardVolText.textContent = Math.round(config.boardVolume * 100) + '%';
    saveConfig();
  });

  muteMonitorCheck.addEventListener('change', (e) => {
    config.monitorMuted = e.target.checked;
    if (monitorOutputEl) monitorOutputEl.muted = config.monitorMuted;
    saveConfig();
  });

  nvidiaLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.openNvidia();
  });

  // Modal
  addSoundBtn.addEventListener('click', () => {
    pendingFilePath = null;
    editingSoundId = null;
    soundNameInput.value = '';
    shortcutInput.value = '';
    filePathDisplay.textContent = 'Aucun fichier';
    soundFormOverlay.classList.remove('hidden');
  });

  cancelSoundBtn.addEventListener('click', () => {
    soundFormOverlay.classList.add('hidden');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordMicBtn.textContent = "Rec";
        recordMicBtn.style.color = "var(--danger)";
    }
  });

  shortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Escape') {
      shortcutInput.value = '';
      return;
    }
    
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    let keys = [];
    if (e.ctrlKey) keys.push('CommandOrControl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Super');

    let key = e.key;
    if (key === 'Dead' || key === 'Unidentified') return;
    
    // Electron specific mappings
    const keyMap = {
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Escape': 'Esc'
    };
    if (keyMap[key]) {
      key = keyMap[key];
    }
    
    if (e.code.startsWith('Numpad')) {
      if (e.code.length === 7 && e.code >= 'Numpad0' && e.code <= 'Numpad9') {
        key = 'num' + e.code[6];
      } else {
        switch(e.code) {
          case 'NumpadAdd': key = 'numadd'; break;
          case 'NumpadSubtract': key = 'numsub'; break;
          case 'NumpadMultiply': key = 'nummult'; break;
          case 'NumpadDivide': key = 'numdiv'; break;
          case 'NumpadDecimal': key = 'numdec'; break;
        }
      }
    } else if (key.length === 1 && key >= 'a' && key <= 'z') {
      key = key.toUpperCase();
    } else if (e.code === 'Space') {
      key = 'Space';
    }
    
    keys.push(key);
    shortcutInput.value = keys.join('+');
  });

  pickFileBtn.addEventListener('click', async () => {
    const filePath = await window.electronAPI.openFileDialog();
    if (filePath) {
      pendingFilePath = filePath;
      const name = filePath.split(/[/\\]/).pop().split('.')[0];
      filePathDisplay.textContent = name;
      if (!soundNameInput.value) soundNameInput.value = name;
    }
  });

  recordMicBtn.addEventListener('click', () => {
    if (!currentMicStream) {
      alert("Erreur: Aucun microphone n'est sélectionné/branché en entrée.");
      return;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      recordMicBtn.textContent = "Rec";
      recordMicBtn.style.color = "var(--danger)";
    } else {
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(currentMicStream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const savedPath = await window.electronAPI.saveRecordedAudio(arrayBuffer);
        
        pendingFilePath = savedPath;
        filePathDisplay.textContent = "Audio Enregistré (Micro)";
        if (!soundNameInput.value) soundNameInput.value = "Nouvel enregistrement";
      };
      
      mediaRecorder.start();
      recordMicBtn.textContent = "Stop";
      recordMicBtn.style.color = "white";
    }
  });

  saveSoundBtn.addEventListener('click', () => {
    if (!pendingFilePath || !soundNameInput.value) {
      alert('Veuillez sélectionner (ou enregistrer) un fichier et donner un nom.');
      return;
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordMicBtn.textContent = "Rec";
        recordMicBtn.style.color = "var(--danger)";
    }

    if (editingSoundId) {
      // Edit Mode
      const soundIndex = config.sounds.findIndex(s => s.id === editingSoundId);
      if (soundIndex >= 0) {
        const oldSound = config.sounds[soundIndex];
        if (oldSound.shortcut) window.electronAPI.unregisterShortcut(oldSound.shortcut);
        
        config.sounds[soundIndex] = {
            id: editingSoundId,
            name: soundNameInput.value,
            filePath: pendingFilePath,
            shortcut: shortcutInput.value.trim()
        };
        
        if (config.sounds[soundIndex].shortcut) {
            window.electronAPI.registerShortcut(config.sounds[soundIndex].id, config.sounds[soundIndex].shortcut);
        }
      }
    } else {
      // Create Mode
      const newSound = {
        id: Date.now().toString(),
        name: soundNameInput.value,
        filePath: pendingFilePath,
        shortcut: shortcutInput.value.trim()
      };
      config.sounds.push(newSound);
      if (newSound.shortcut) {
        window.electronAPI.registerShortcut(newSound.id, newSound.shortcut);
      }
    }
    
    saveConfig();
    renderSounds();
    soundFormOverlay.classList.add('hidden');
  });
}

// Rendering
function renderSounds() {
  soundsGrid.innerHTML = '';
  config.sounds.forEach(sound => {
    const card = document.createElement('div');
    card.className = 'sound-card';
    card.id = `sound-${sound.id}`;
    
    const title = document.createElement('h3');
    title.textContent = sound.name;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Supprimer';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSound(sound.id);
    };

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.innerHTML = '✎';
    editBtn.title = 'Modifier';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      openEditModal(sound);
    };

    card.appendChild(title);
    
    if (sound.shortcut) {
      const badge = document.createElement('span');
      badge.className = 'shortcut-badge';
      badge.textContent = sound.shortcut;
      card.appendChild(badge);
    }
    
    card.appendChild(editBtn);
    card.appendChild(deleteBtn);
    
    card.onclick = () => playSound(sound.filePath, sound.id);
    
    soundsGrid.appendChild(card);
  });
}

function openEditModal(sound) {
  editingSoundId = sound.id;
  pendingFilePath = sound.filePath;
  soundNameInput.value = sound.name;
  shortcutInput.value = sound.shortcut || '';
  filePathDisplay.textContent = sound.filePath.split(/[/\\]/).pop();
  soundFormOverlay.classList.remove('hidden');
}

function deleteSound(id) {
  const sound = config.sounds.find(s => s.id === id);
  if (sound && sound.shortcut) {
    window.electronAPI.unregisterShortcut(sound.shortcut);
  }
  config.sounds = config.sounds.filter(s => s.id !== id);
  saveConfig();
  renderSounds();
}

function registerAllShortcuts() {
  window.electronAPI.unregisterAllShortcuts();
  config.sounds.forEach(s => {
    if (s.shortcut) {
      window.electronAPI.registerShortcut(s.id, s.shortcut);
    }
  });
  if (config.discordRecordShortcut) {
    window.electronAPI.registerShortcut('discord-record-shortcut', config.discordRecordShortcut);
  }
}

function saveConfig() {
  window.electronAPI.saveConfig(config);
}

function setStatus(msg) {
  console.log(`Statut: ${msg}`);
}

// Visual indicator update
function updateWorkflowStatus() {
  const nodeMic = document.getElementById('node-mic');
  const nodeNvidia = document.getElementById('node-nvidia');
  const nodeDiscord = document.getElementById('node-discord');
  const conn1 = document.getElementById('conn-1');
  const conn2 = document.getElementById('conn-2');
  const conn3 = document.getElementById('conn-3');

  if (!nodeMic) return;

  const inputSelect = document.getElementById('inputDevice');
  const hasInput = config.inputDeviceId && config.inputDeviceId !== '';
  const hasOutput = config.virtualDeviceId && config.virtualDeviceId !== '';
  
  let isNvidia = false;
  if (hasInput && inputSelect.selectedIndex >= 0) {
    const text = inputSelect.options[inputSelect.selectedIndex].text.toLowerCase();
    isNvidia = text.includes('nvidia') || text.includes('broadcast');
  }

  // 1. Mic node
  nodeMic.className = hasInput ? 'workflow-node active' : 'workflow-node error';
  
  // 2. Nvidia Broadcast node
  if (!hasInput) {
    nodeNvidia.className = 'workflow-node error';
    conn1.className = 'workflow-connector';
    conn2.className = 'workflow-connector';
  } else if (isNvidia) {
    // Nvidia is used explicitly
    nodeNvidia.className = 'workflow-node active';
    conn1.className = 'workflow-connector active';
    conn2.className = 'workflow-connector active';
  } else {
    // Skipped but signal passes
    nodeNvidia.className = 'workflow-node';
    conn1.className = 'workflow-connector active';
    conn2.className = 'workflow-connector active';
  }

  // 3. Output to Discord
  nodeDiscord.className = hasOutput ? 'workflow-node active' : 'workflow-node error';
  conn3.className = hasOutput ? 'workflow-connector active' : 'workflow-connector';
}

function audioBufferToWav(buffer, opt) {
  opt = opt || {};
  let numChannels = buffer.numberOfChannels;
  let sampleRate = buffer.sampleRate;
  let format = opt.float32 ? 3 : 1;
  let bitDepth = format === 3 ? 32 : 16;
  
  let result;
  if (numChannels === 2) {
    let channel1 = buffer.getChannelData(0);
    let channel2 = buffer.getChannelData(1);
    let length = channel1.length + channel2.length;
    result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    while (index < length) {
      result[index++] = channel1[inputIndex];
      result[index++] = channel2[inputIndex];
      inputIndex++;
    }
  } else {
    result = buffer.getChannelData(0);
  }
  
  return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}

function encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
  let bytesPerSample = bitDepth / 8;
  let blockAlign = numChannels * bytesPerSample;
  let buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  let view = new DataView(buffer);
  
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  
  if (format === 1) { // PCM
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  } else {
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 4) {
      view.setFloat32(offset, samples[i], true);
    }
  }
  return buffer;
}

// Start
init();
