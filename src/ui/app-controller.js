import { uid, formatTime, formatBytes, escapeHtml, debounce, clamp } from '../utils/format.js';

export class AppController {
  constructor({ bus, audio, recorder, storage, analyzer, visuals, capabilities }) {
    Object.assign(this, { bus, audio, recorder, storage, analyzer, visuals, capabilities });
    this.els = Object.fromEntries([...document.querySelectorAll('[id]')].map(el => [el.id, el]));
    this.tracks = []; this.currentIndex = -1; this.currentAnalysis = null; this.page = 'studio'; this.uiHidden = false; this.hideTimer = null; this.pendingMicAction = 'visualize';
    this.settings = {
      visualMode:'waterline', intensity:1, particleDensity:.55, smoothing:.78, palette:'water-paper', plants:true, reducedMotion:false,
      recordingMime: capabilities.recordingTypes[0] || '', noiseSuppression:true, echoCancellation:true, autoGainControl:false
    };
  }

  async init() {
    await this.storage.open();
    const stored = await this.storage.getSetting('app-settings', null); if (stored) this.settings = { ...this.settings, ...stored };
    this.applySettings(); this.bindEvents(); this.renderCapabilities(); this.renderRecordingTypes();
    await this.loadLibrary(); await this.restoreSession(); await this.refreshStorageUsage();
    const skip = localStorage.getItem('mizune-skip-welcome') === '1'; if (skip) this.closeWelcome();
    this.visuals.start(); this.registerServiceWorker(); this.resetAutoHide();
  }

  bindEvents() {
    const e=this.els;
    e.welcomeFileButton.onclick=()=>{this.closeWelcome();e.fileInput.click();};
    e.welcomeMicButton.onclick=()=>{this.pendingMicAction='visualize';this.showPermissionDialog();};
    e.welcomeDemoButton.onclick=async()=>{this.closeWelcome();await this.audio.startDemo();this.setVisualIdentity('Water Garden Demo','合成音をリアルタイム可視化しています');};
    e.confirmPermissionButton.onclick=()=>this.enableMicrophone(this.pendingMicAction);
    e.cancelPermissionButton.onclick=()=>this.hidePermissionDialog();
    e.addFilesButton.onclick=()=>e.fileInput.click(); e.libraryImportButton.onclick=()=>e.fileInput.click(); e.welcomeFileButton.onclick=()=>{this.closeWelcome();e.fileInput.click();};
    e.fileInput.onchange=event=>this.importFiles([...event.target.files]);
    e.playButton.onclick=()=>this.togglePlay(); e.previousButton.onclick=()=>this.selectRelative(-1); e.nextButton.onclick=()=>this.selectRelative(1);
    e.seekRange.oninput=()=>{const state=this.audio.getTimeState();if(state.duration)this.audio.seek(Number(e.seekRange.value)/1000*state.duration);};
    e.micButton.onclick=()=>{this.pendingMicAction='visualize';this.showPermissionDialog();}; e.recordButton.onclick=()=>this.toggleRecording();
    e.fullscreenButton.onclick=()=>this.toggleFullscreen(); e.compactToggle.onclick=()=>this.toggleCompact(); e.transportBar.addEventListener('click',()=>{if(this.uiHidden)this.toggleCompact();});
    e.playlistToggle.onclick=()=>e.playlistPanel.classList.toggle('is-open'); e.settingsToggle.onclick=()=>e.settingsPanel.classList.toggle('is-open');
    e.closePlaylistPanel.onclick=()=>e.playlistPanel.classList.remove('is-open'); e.closeSettingsPanel.onclick=()=>e.settingsPanel.classList.remove('is-open');
    e.brandButton.onclick=()=>this.showWelcome();
    e.clearPlaylistButton.onclick=()=>{this.audio.pause();this.tracks=[];this.currentIndex=-1;this.currentAnalysis=null;this.renderPlaylist();this.renderAnalysis();this.updateTransport();this.saveSession();this.setVisualIdentity('音を待っています','マイク、音楽ファイル、またはデモ音源を選択してください。');};
    e.visualModeSelect.onchange=()=>this.updateSetting('visualMode',e.visualModeSelect.value);
    e.intensityRange.oninput=()=>{e.intensityOutput.value=Number(e.intensityRange.value).toFixed(2);this.updateSetting('intensity',Number(e.intensityRange.value),false);};
    e.particleRange.oninput=()=>{e.particleOutput.value=`${e.particleRange.value}%`;this.updateSetting('particleDensity',Number(e.particleRange.value)/100,false);};
    e.smoothingRange.oninput=()=>{e.smoothingOutput.value=Number(e.smoothingRange.value).toFixed(2);this.updateSetting('smoothing',Number(e.smoothingRange.value),false);};
    e.paletteSelect.onchange=()=>this.updateSetting('palette',e.paletteSelect.value);
    e.plantToggle.onchange=()=>this.updateSetting('plants',e.plantToggle.checked); e.reducedMotionToggle.onchange=()=>this.updateSetting('reducedMotion',e.reducedMotionToggle.checked);
    e.recordingMime.onchange=()=>this.updateSetting('recordingMime',e.recordingMime.value); e.noiseSuppressionToggle.onchange=()=>this.updateSetting('noiseSuppression',e.noiseSuppressionToggle.checked);
    e.echoCancellationToggle.onchange=()=>this.updateSetting('echoCancellation',e.echoCancellationToggle.checked); e.autoGainToggle.onchange=()=>this.updateSetting('autoGainControl',e.autoGainToggle.checked);
    e.analyzeCurrentButton.onclick=()=>this.analyzeCurrent(); e.overviewCanvas.onclick=event=>this.seekFromOverview(event);
    e.librarySearch.oninput=debounce(()=>this.renderLibrary(),150); e.libraryFilter.onchange=()=>this.renderLibrary();
    e.deleteAllButton.onclick=()=>this.deleteAllData(); e.clearCacheButton.onclick=()=>this.clearAnalysisCache();
    e.exportSettingsButton.onclick=()=>this.exportSettings(); e.importSettingsInput.onchange=event=>this.importSettings(event.target.files[0]);
    document.querySelectorAll('[data-page-target]').forEach(button=>button.onclick=()=>this.navigate(button.dataset.pageTarget));
    document.addEventListener('keydown',event=>this.handleShortcut(event));
    document.addEventListener('mousemove',()=>this.resetAutoHide(),{passive:true}); document.addEventListener('touchstart',()=>this.resetAutoHide(),{passive:true});
    window.addEventListener('dragenter',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();e.dropOverlay.hidden=false;}});
    window.addEventListener('dragover',event=>event.preventDefault());
    window.addEventListener('dragleave',event=>{if(event.target===document.documentElement)e.dropOverlay.hidden=true;});
    window.addEventListener('drop',event=>{event.preventDefault();e.dropOverlay.hidden=true;this.importFiles([...event.dataTransfer.files].filter(file=>file.type.startsWith('audio/')||/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name)));});

    this.bus.on('visual-metrics',metrics=>this.updateLiveMetrics(metrics));
    this.bus.on('playstate',state=>this.updatePlayButton(state.playing)); this.bus.on('timeupdate',state=>this.updateTime(state)); this.bus.on('duration',state=>this.updateTime(state));
    this.bus.on('ended',()=>this.selectRelative(1)); this.bus.on('audio-error',()=>this.toast('音声を再生できませんでした。形式またはファイルを確認してください。','error'));
    this.bus.on('record-time',seconds=>{e.recordLabel.textContent=formatTime(seconds);});
    this.bus.on('record-state',state=>this.handleRecordState(state)); this.bus.on('record-error',error=>this.toast(error.message||'録音中にエラーが発生しました。','error'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)e.fpsLabel.textContent='休止';});
  }

  applySettings() {
    const s=this.settings,e=this.els;
    e.visualModeSelect.value=s.visualMode;e.intensityRange.value=s.intensity;e.intensityOutput.value=Number(s.intensity).toFixed(2);
    e.particleRange.value=Math.round(s.particleDensity*100);e.particleOutput.value=`${Math.round(s.particleDensity*100)}%`;e.smoothingRange.value=s.smoothing;e.smoothingOutput.value=Number(s.smoothing).toFixed(2);
    e.paletteSelect.value=s.palette;e.plantToggle.checked=s.plants;e.reducedMotionToggle.checked=s.reducedMotion;
    e.noiseSuppressionToggle.checked=s.noiseSuppression;e.echoCancellationToggle.checked=s.echoCancellation;e.autoGainToggle.checked=s.autoGainControl;
    this.visuals.setMode(s.visualMode);this.visuals.setIntensity(s.intensity);this.visuals.setParticleDensity(s.particleDensity);this.visuals.setPalette(s.palette);this.visuals.setPlantsEnabled(s.plants);this.visuals.setReducedMotion(s.reducedMotion);this.audio.setSmoothing(s.smoothing);
  }
  async updateSetting(key,value,persist=true) { this.settings[key]=value; this.applySettings(); if(persist) await this.storage.setSetting('app-settings',this.settings); else this.persistSettingsDebounced(); }
  persistSettingsDebounced=debounce(()=>this.storage.setSetting('app-settings',this.settings),250);

  async importFiles(files) {
    if (!files.length) return; this.closeWelcome(); let firstIndex=this.tracks.length;
    for (const file of files) {
      const id=uid('track'); const track={id,title:file.name.replace(/\.[^.]+$/,''),originalFileName:file.name,sourceType:'file',mimeType:file.type||'audio/unknown',duration:0,fileSize:file.size,createdAt:Date.now(),updatedAt:Date.now(),tags:[],favorite:false,blob:file};
      try { await this.storage.putTrack(track); this.tracks.push(track); } catch(error){this.toast(`${file.name} を保存できませんでした。`,'error');}
    }
    this.renderPlaylist();this.saveSession();this.renderLibrary();await this.refreshStorageUsage();
    if(this.currentIndex<0&&this.tracks.length){await this.selectTrack(firstIndex);}
    this.toast(`${files.length}件の音源を追加しました。`);
    this.els.fileInput.value='';
  }

  async loadLibrary() { try { this.libraryTracks=(await this.storage.getTracks()).sort((a,b)=>b.createdAt-a.createdAt); } catch { this.libraryTracks=[]; } this.renderLibrary(); }
  async refreshLibraryCache() { this.libraryTracks=(await this.storage.getTracks()).sort((a,b)=>b.createdAt-a.createdAt); }

  renderPlaylist() {
    const e=this.els;e.playlistList.innerHTML=this.tracks.map((track,index)=>`<article class="track-row ${index===this.currentIndex?'is-current':''}" data-track-index="${index}"><button class="track-select" type="button"><span class="mini-wave" aria-hidden="true"></span><span><strong>${escapeHtml(track.title)}</strong><small>${track.sourceType==='recording'?'録音':formatBytes(track.fileSize)}</small></span></button><button class="track-remove" type="button" aria-label="一覧から削除">×</button></article>`).join('');
    e.dropHint.hidden=this.tracks.length>0;
    e.playlistList.querySelectorAll('.track-row').forEach(row=>{row.draggable=true;row.querySelector('.track-select').onclick=()=>this.selectTrack(Number(row.dataset.trackIndex));row.querySelector('.track-remove').onclick=ev=>{ev.stopPropagation();this.removeFromPlaylist(Number(row.dataset.trackIndex));};row.ondragstart=event=>event.dataTransfer.setData('text/mizune-index',row.dataset.trackIndex);row.ondragover=event=>event.preventDefault();row.ondrop=event=>{event.preventDefault();const from=Number(event.dataTransfer.getData('text/mizune-index'));const to=Number(row.dataset.trackIndex);this.reorderPlaylist(from,to);};});
  }
  removeFromPlaylist(index){this.tracks.splice(index,1);if(index===this.currentIndex){this.audio.pause();this.currentIndex=-1;this.currentAnalysis=null;}else if(index<this.currentIndex)this.currentIndex--;this.renderPlaylist();this.renderAnalysis();this.updateTransport();this.saveSession();}
  reorderPlaylist(from,to){if(!Number.isInteger(from)||!Number.isInteger(to)||from===to||from<0||to<0)return;const [moved]=this.tracks.splice(from,1);this.tracks.splice(to,0,moved);if(this.currentIndex===from)this.currentIndex=to;else if(from<this.currentIndex&&to>=this.currentIndex)this.currentIndex--;else if(from>this.currentIndex&&to<=this.currentIndex)this.currentIndex++;this.renderPlaylist();this.saveSession();}
  async saveSession(){await this.storage.setSetting('session-track-ids',this.tracks.map(track=>track.id));}
  async restoreSession(){const ids=await this.storage.getSetting('session-track-ids',[]);this.tracks=ids.map(id=>this.libraryTracks.find(track=>track.id===id)).filter(Boolean);this.renderPlaylist();}

  async selectTrack(index, autoplay=false) {
    if(index<0||index>=this.tracks.length)return;this.currentIndex=index;const track=this.tracks[index];
    try { await this.audio.loadTrack(track); track.duration=this.audio.getTimeState().duration; await this.storage.putTrack(track); this.setVisualIdentity(track.title,`${track.sourceType==='recording'?'録音':'音楽ファイル'} · ${formatTime(track.duration)}`); this.currentAnalysis=await this.storage.getAnalysis(track.id); this.renderAnalysis(); if(autoplay)await this.audio.play(); }
    catch(error){this.toast(error.message,'error');}
    this.renderPlaylist();this.updateTransport();this.saveSession();
  }
  async selectRelative(delta){if(!this.tracks.length)return;const next=(this.currentIndex+delta+this.tracks.length)%this.tracks.length;await this.selectTrack(next,true);}
  async togglePlay(){if(this.audio.mode==='file')await this.audio.toggle();else if(this.currentIndex>=0)await this.audio.play();else this.toast('先に音源を追加するか、マイクを開始してください。');}
  updatePlayButton(playing){this.els.playButton.textContent=playing?'Ⅱ':'▶';this.els.playButton.setAttribute('aria-label',playing?'一時停止':'再生');}
  updateTransport(){const track=this.tracks[this.currentIndex];this.els.currentTrackTitle.textContent=track?.title||'音源未選択';this.updateTime(this.audio.getTimeState());}
  updateTime({currentTime=0,duration=0}){this.els.timeLabel.textContent=`${formatTime(currentTime)} / ${formatTime(duration)}`;this.els.seekRange.value=duration?Math.round(currentTime/duration*1000):0;}
  setVisualIdentity(title,subtitle){this.els.visualTitle.textContent=title;this.els.visualSubtitle.textContent=subtitle;this.els.idleMessage.classList.add('has-source');}

  showPermissionDialog(){this.closeWelcome();this.els.permissionDialog.hidden=false;}
  hidePermissionDialog(){this.els.permissionDialog.hidden=true;}
  async enableMicrophone(action='visualize'){
    this.hidePermissionDialog();
    try { const stream=await this.audio.useMicrophone(this.settings);this.setVisualIdentity('Microphone Input','リアルタイム音声を端末内で解析しています');this.els.micButton.classList.add('is-active');if(action==='record')this.startRecording(stream);this.toast('マイク入力を開始しました。'); }
    catch(error){const message=error.name==='NotAllowedError'?'マイクの使用が許可されませんでした。ブラウザのサイト設定を確認してください。':error.message||'マイクを開始できませんでした。';this.toast(message,'error');}
  }
  async toggleRecording(){if(this.recorder.isRecording){await this.recorder.stop();return;}if(!this.audio.stream){this.pendingMicAction='record';this.showPermissionDialog();}else this.startRecording(this.audio.stream);}
  startRecording(stream){try{this.recorder.start(stream,this.settings.recordingMime);this.els.recordButton.classList.add('is-recording');this.els.recordLabel.textContent='0:00';this.setVisualIdentity('Recording','録音中です。停止ボタンは常に表示されます。');}catch(error){this.toast(error.message,'error');}}
  async handleRecordState(state){if(state.state==='stopped'&&state.blob){this.els.recordButton.classList.remove('is-recording');this.els.recordLabel.textContent='REC';const stamp=new Date().toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});const track={id:uid('recording'),title:`録音 ${stamp}`,originalFileName:null,sourceType:'recording',mimeType:state.mimeType,duration:state.duration,fileSize:state.blob.size,createdAt:Date.now(),updatedAt:Date.now(),tags:['録音'],favorite:false,blob:state.blob};await this.storage.putTrack(track);this.tracks.push(track);await this.refreshLibraryCache();this.renderPlaylist();this.renderLibrary();await this.selectTrack(this.tracks.length-1);this.toast('録音をブラウザ内へ保存しました。');await this.refreshStorageUsage();}}

  updateLiveMetrics(m){this.els.rmsValue.textContent=(m.rms||0).toFixed(3);this.els.peakValue.textContent=(m.peak||0).toFixed(3);this.els.bandValue.textContent=m.dominantBand||'—';this.els.fpsLabel.textContent=`${m.fps||0}`;this.els.qualityLabel.textContent=m.quality>.88?'高品質':m.quality>.65?'標準':m.quality>.45?'省負荷':'最低負荷';document.documentElement.style.setProperty('--audio-energy',clamp((m.smoothRms||0)*4,0,1));}

  navigate(page){this.page=page;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('is-active',el.dataset.page===page));document.querySelectorAll('[data-page-target]').forEach(el=>el.classList.toggle('is-active',el.dataset.pageTarget===page));this.els.app.dataset.page=page;if(page==='library')this.renderLibrary();if(page==='analysis')this.renderAnalysis();this.resetAutoHide();}
  toggleCompact(){this.uiHidden=!this.uiHidden;this.els.app.classList.toggle('ui-compact',this.uiHidden);}
  resetAutoHide(){clearTimeout(this.hideTimer);this.els.app.classList.remove('ui-idle');if(this.page==='studio'&&this.audio.mode!=='idle')this.hideTimer=setTimeout(()=>this.els.app.classList.add('ui-idle'),4200);}
  async toggleFullscreen(){if(!document.fullscreenElement)await document.documentElement.requestFullscreen?.();else await document.exitFullscreen?.();}
  closeWelcome(){this.els.welcomeDialog.classList.add('is-closed');localStorage.setItem('mizune-skip-welcome',this.els.skipWelcomeToggle.checked?'1':'0');}
  showWelcome(){this.els.welcomeDialog.classList.remove('is-closed');}

  async analyzeCurrent(){const track=this.tracks[this.currentIndex];if(!track){this.toast('解析する音源を選択してください。');return;}this.navigate('analysis');this.els.analyzeCurrentButton.disabled=true;this.els.analyzeCurrentButton.textContent='解析 0%';try{await this.audio.ensureContext();const result=await this.analyzer.analyzeBlob(track.blob,this.audio.context,progress=>{this.els.analyzeCurrentButton.textContent=`解析 ${Math.round(progress*100)}%`;});result.trackId=track.id;await this.storage.putAnalysis(result);this.currentAnalysis=result;this.renderAnalysis();this.toast('音声区間の解析が完了しました。');}catch(error){this.toast(error.message||'解析に失敗しました。','error');}finally{this.els.analyzeCurrentButton.disabled=false;this.els.analyzeCurrentButton.textContent='現在の音源を解析';}}
  renderAnalysis(){const a=this.currentAnalysis,track=this.tracks[this.currentIndex];this.els.analysisLead.textContent=track?`${track.title} の解析結果を表示します。`:'音源を選択すると、音量・無音・主要音域の変化を端末内で解析します。';if(!a){this.els.analysisStats.innerHTML='<div class="empty-card">解析結果はまだありません。</div>';this.els.segmentList.innerHTML='';this.els.segmentCount.textContent='0 sections';this.drawOverview(null);return;}
    const dominant={low:'低音',mid:'中音',high:'高音'}[a.dominantBand]||a.dominantBand;
    this.els.analysisStats.innerHTML=[['平均RMS',a.averageRms.toFixed(3)],['ピーク',a.peak.toFixed(3)],['無音率',`${Math.round(a.silenceRatio*100)}%`],['主要音域',dominant],['推定テンポ',a.estimatedTempo?`${a.estimatedTempo} BPM`:'判定不能'],['サンプルレート',`${a.sampleRate.toLocaleString()} Hz`]].map(([k,v])=>`<article class="stat-card glass-panel"><small>${k}</small><strong>${v}</strong></article>`).join('');
    this.els.segmentCount.textContent=`${a.segments.length} sections`;this.els.segmentList.innerHTML=a.segments.map((s,i)=>`<article class="segment-card glass-panel" data-segment="${i}"><div class="segment-type type-${s.type}"><span></span>${this.segmentLabel(s.type)}</div><div><strong>${formatTime(s.startTime)} – ${formatTime(s.endTime)}</strong><small>${(s.endTime-s.startTime).toFixed(1)}秒 · RMS ${s.averageRms.toFixed(3)} · Peak ${s.peak.toFixed(3)}</small></div><button class="quiet-button" type="button">この区間を再生</button></article>`).join('');
    this.els.segmentList.querySelectorAll('.segment-card').forEach(card=>card.querySelector('button').onclick=()=>{const s=a.segments[Number(card.dataset.segment)];this.audio.seek(s.startTime);this.audio.play();this.navigate('studio');});this.drawOverview(a);
  }
  segmentLabel(type){return({silence:'無音',quiet:'静か',loud:'大音量',peak:'ピーク',low:'低音優勢',mid:'中音優勢',high:'高音優勢'})[type]||type;}
  drawOverview(a){const canvas=this.els.overviewCanvas,rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,rect.width*dpr);canvas.height=180*dpr;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=180;ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(255,255,255,.14)';ctx.fillRect(0,0,w,h);if(!a)return;ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()||'#596c67';ctx.globalAlpha=.58;ctx.beginPath();a.waveform.forEach(([min,max],i)=>{const x=i/(a.waveform.length-1)*w;ctx.moveTo(x,h/2+min*h*.42);ctx.lineTo(x,h/2+max*h*.42);});ctx.stroke();const colors={silence:'rgba(143,175,180,.10)',quiet:'rgba(191,216,220,.12)',loud:'rgba(116,139,121,.13)',peak:'rgba(180,130,110,.14)',low:'rgba(116,139,121,.11)',mid:'rgba(216,204,183,.14)',high:'rgba(191,216,220,.16)'};a.segments.forEach(s=>{ctx.fillStyle=colors[s.type]||'rgba(0,0,0,.04)';ctx.fillRect(s.startTime/a.duration*w,0,(s.endTime-s.startTime)/a.duration*w,h);});}
  seekFromOverview(event){if(!this.currentAnalysis)return;const rect=this.els.overviewCanvas.getBoundingClientRect();this.audio.seek(clamp((event.clientX-rect.left)/rect.width,0,1)*this.currentAnalysis.duration);}

  async renderLibrary(){await this.refreshLibraryCache();const query=(this.els.librarySearch?.value||'').toLowerCase();const filter=this.els.libraryFilter?.value||'all';const list=this.libraryTracks.filter(t=>(!query||`${t.title} ${t.originalFileName||''} ${(t.tags||[]).join(' ')}`.toLowerCase().includes(query))&&(filter==='all'||filter===t.sourceType||(filter==='favorite'&&t.favorite)));
    this.els.libraryGrid.innerHTML=list.length?list.map(t=>`<article class="library-card paper-panel" data-id="${t.id}"><div class="library-wave"><span></span><span></span><span></span><span></span><span></span></div><div><small>${t.sourceType==='recording'?'RECORDING':'AUDIO FILE'}</small><h3>${escapeHtml(t.title)}</h3><p>${formatTime(t.duration)} · ${formatBytes(t.fileSize)}</p></div><div class="library-actions"><button class="favorite-button ${t.favorite?'is-active':''}" type="button" aria-label="お気に入り">◇</button><button class="soft-button add-library-track" type="button">再生一覧へ</button><button class="quiet-button download-library-track" type="button">保存</button><button class="danger-text delete-library-track" type="button">削除</button></div></article>`).join(''):'<div class="empty-card">条件に一致する音源がありません。</div>';
    this.els.libraryGrid.querySelectorAll('.library-card').forEach(card=>{const id=card.dataset.id;const track=list.find(t=>t.id===id);card.querySelector('.add-library-track').onclick=async()=>{if(!this.tracks.some(t=>t.id===id))this.tracks.push(track);this.renderPlaylist();this.saveSession();await this.selectTrack(this.tracks.findIndex(t=>t.id===id));this.navigate('studio');};card.querySelector('.favorite-button').onclick=async()=>{track.favorite=!track.favorite;await this.storage.putTrack(track);this.renderLibrary();};card.querySelector('.download-library-track').onclick=()=>this.downloadTrack(track);card.querySelector('.delete-library-track').onclick=()=>this.deleteTrack(track);});
  }
  downloadTrack(track){const url=URL.createObjectURL(track.blob),a=document.createElement('a');a.href=url;a.download=track.originalFileName||`${track.title}.${track.mimeType.includes('ogg')?'ogg':track.mimeType.includes('mp4')?'m4a':'webm'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async deleteTrack(track){if(!confirm(`「${track.title}」をブラウザ内から削除しますか？`))return;await this.storage.deleteTrack(track.id);this.tracks=this.tracks.filter(t=>t.id!==track.id);this.saveSession();if(this.currentIndex>=this.tracks.length)this.currentIndex=this.tracks.length-1;await this.refreshLibraryCache();this.renderPlaylist();this.renderLibrary();await this.refreshStorageUsage();}
  async deleteAllData(){if(!confirm('MIZUNEが保存した音源、録音、解析、設定をすべて削除します。元に戻せません。'))return;await this.storage.clearAll();this.tracks=[];this.libraryTracks=[];this.currentIndex=-1;await this.saveSession();this.currentAnalysis=null;this.renderPlaylist();this.renderLibrary();this.renderAnalysis();this.updateTransport();this.toast('ブラウザ内のMIZUNEデータを削除しました。');await this.refreshStorageUsage();}
  async clearAnalysisCache(){await this.storage.clearAnalyses();this.currentAnalysis=null;this.renderAnalysis();this.toast('解析キャッシュを削除しました。');}

  renderCapabilities(){const c=this.capabilities;const rows=[['安全な接続',c.secureContext],['Web Audio',c.webAudio],['マイク',c.microphone],['録音',c.mediaRecorder],['IndexedDB',c.indexedDB],['Web Worker',c.worker],['PWA',c.serviceWorker],['全画面',c.fullscreen]];this.els.capabilityList.innerHTML=rows.map(([name,ok])=>`<span><strong>${name}</strong><b class="${ok?'ok':'ng'}">${ok?'利用可能':'非対応'}</b></span>`).join('')+`<p>CPU論理コア: ${c.hardwareConcurrency||'不明'} / 推定メモリ: ${c.deviceMemory?`${c.deviceMemory} GB`:'取得不可'}</p>`;}
  renderRecordingTypes(){const types=this.capabilities.recordingTypes;this.els.recordingMime.innerHTML=types.length?types.map(type=>`<option value="${type}">${type}</option>`):'<option value="">ブラウザ既定</option>';this.els.recordingMime.value=types.includes(this.settings.recordingMime)?this.settings.recordingMime:(types[0]||'');this.settings.recordingMime=this.els.recordingMime.value;}
  async refreshStorageUsage(){if(!navigator.storage?.estimate){this.els.storageUsage.textContent='保存容量情報は取得できません。';return;}const {usage=0,quota=0}=await navigator.storage.estimate();this.els.storageUsage.textContent=`使用中 ${formatBytes(usage)} / 利用可能上限の目安 ${formatBytes(quota)}`;}
  exportSettings(){const blob=new Blob([JSON.stringify(this.settings,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mizune-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async importSettings(file){if(!file)return;try{const parsed=JSON.parse(await file.text());this.settings={...this.settings,...parsed};this.applySettings();await this.storage.setSetting('app-settings',this.settings);this.toast('設定を読み込みました。');}catch{this.toast('設定ファイルを読み込めませんでした。','error');}}

  handleShortcut(event){if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(event.code==='Space'){event.preventDefault();this.togglePlay();}else if(event.key.toLowerCase()==='r')this.toggleRecording();else if(event.key.toLowerCase()==='f')this.toggleFullscreen();else if(event.key.toLowerCase()==='v'){const values=[...this.els.visualModeSelect.options].map(o=>o.value);const next=values[(values.indexOf(this.settings.visualMode)+1)%values.length];this.updateSetting('visualMode',next);}else if(event.key==='ArrowLeft')this.audio.seek(this.audio.getTimeState().currentTime-(event.shiftKey?30:5));else if(event.key==='ArrowRight')this.audio.seek(this.audio.getTimeState().currentTime+(event.shiftKey?30:5));else if(event.key==='Escape'){this.els.playlistPanel.classList.remove('is-open');this.els.settingsPanel.classList.remove('is-open');}}
  toast(message,type='info'){const toast=document.createElement('div');toast.className=`toast ${type}`;toast.textContent=message;this.els.toastRegion.append(toast);setTimeout(()=>toast.classList.add('show'),20);setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>toast.remove(),300);},4200);}
  registerServiceWorker(){if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});}
}
