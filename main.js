/**
 * 2人同時操作 Webオンラインゲーム (ピクロス Co-op)
 * 
 * - Windows (PC) & iPad (Safari) リアルタイム同期
 * - PeerJS (WebRTC) P2P Master/Worker アーキテクチャ
 * - 4,180種類のベクターアイコン (Path2D) から瞬時に動的ピクロス生成 (0.001秒)
 * - 盤面サイズ可変 (5x5, 10x10, 15x15, 20x20)
 * - クリア時の元ベクター画像クロスフェード & スタイリッシュ演出
 */

(function () {
  'use strict';

  /* ==========================================================================
     0. アクセス認証ガード (URL末尾が #shishamochandayo 以外はメンテナンス表示)
     ========================================================================== */
  const ACCESS_KEY = '#shishamochandayo';
  const currentHash = (window.location.hash || '').toLowerCase();
  const isAuthorized = (currentHash === ACCESS_KEY);

  const maintenanceOverlay = document.getElementById('maintenance-overlay');
  if (!isAuthorized) {
    if (maintenanceOverlay) {
      maintenanceOverlay.style.display = 'flex';
    }
    console.warn('[Access Restricted] メンテナンス中です。アクセスキーが必要です。');
    window.addEventListener('hashchange', () => location.reload());
    return; // ゲーム初期化を一切行わず完全停止
  } else {
    if (maintenanceOverlay) {
      maintenanceOverlay.style.display = 'none';
    }
    window.addEventListener('hashchange', () => location.reload());
  }

  /* ==========================================================================
     1. フォールバック用プリセットパズル (データ未読み込み時用)
     ========================================================================== */
  const FALLBACK_PUZZLES = [
    {
      name: "Heart ❤️",
      width: 10,
      height: 10,
      data: [
        [0, 1, 1, 0, 0, 0, 1, 1, 0, 0],
        [1, 1, 1, 1, 0, 1, 1, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        [0, 0, 1, 1, 1, 1, 1, 0, 0, 0],
        [0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      ],
      pathData: null
    },
    {
      name: "Music Note 🎵",
      width: 10,
      height: 10,
      data: [
        [0, 0, 0, 0, 1, 1, 1, 1, 1, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 0, 1, 1, 1, 0, 1, 1, 1, 0],
        [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        [0, 1, 1, 1, 0, 1, 1, 1, 0, 0],
        [0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      ],
      pathData: null
    }
  ];

  /* ==========================================================================
     2. アプリケーション状態管理
     ========================================================================== */
  const AppState = {
    roomId: null,
    isHost: false,
    isConnected: false,
    peer: null,
    conn: null,
    heartbeatInterval: null,

    currentSize: 15, // デフォルト: 15x15 (選択肢: 5, 10, 15, 20, 25, 30)

    // 現在のパズルデータ
    puzzle: null,
    rowHints: [],
    colHints: [],
    // 各セルの状態: { state: 0 (空), 1 (塗), 2 (✕), by: 'host' | 'guest' }
    grid: [],
    isSolved: false,

    // クリア演出ステート
    clearAnim: {
      startTime: 0,
      duration: 3000 // 3秒かけてじっくり滑らかに切り替え
    },
    viewModeInClear: 'board', // デフォルトは完成盤面 (クリックで答えの画像を表示)
    titleRevealed: false, // 元画像が表示されきるまでタイトルを隠す（ネタバレ防止）

    // 相手プレイヤーのカーソル位置
    remoteCursor: {
      active: false,
      row: -1,
      col: -1,
      worldX: 0,
      worldY: 0,
      lastUpdate: 0
    },

    // ローカル入力設定
    currentTool: 'fill', // 'fill', 'cross', 'clear'

    // キーボード操作フォーカス位置
    focusedCell: {
      row: 0,
      col: 0,
      active: false
    },

    // カメラ (拡大縮小 & パン移動)
    camera: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      cellSize: 34,
      hintWidth: 100,
      hintHeight: 80
    }
  };

  /* ==========================================================================
     3. DOM要素の参照
     ========================================================================== */
  const DOM = {
    canvas: document.getElementById('game-canvas'),
    canvasContainer: document.getElementById('canvas-container'),
    roleBadge: document.getElementById('role-badge'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    selectBoardSize: document.getElementById('select-board-size'),
    btnShare: document.getElementById('btn-share'),
    btnChangePuzzle: document.getElementById('btn-change-puzzle'),
    welcomeModal: document.getElementById('welcome-modal'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    toolbar: document.getElementById('toolbar'),
    clearBanner: document.getElementById('clear-banner'),
    clearPuzzleTitle: document.getElementById('clear-puzzle-title'),
    btnToggleView: document.getElementById('btn-toggle-view'),
    btnToggleViewText: document.getElementById('btn-toggle-view-text'),
    btnToggleViewIcon: document.getElementById('btn-toggle-view-icon'),
    btnBannerNext: document.getElementById('btn-banner-next'),
    actionToast: document.getElementById('action-toast'),
    // ツールボタン
    toolFill: document.getElementById('tool-fill'),
    toolCross: document.getElementById('tool-cross'),
    toolClear: document.getElementById('tool-clear'),
    btnResetView: document.getElementById('btn-reset-view'),
    // サウンド切替ボタン
    btnToggleSound: document.getElementById('btn-toggle-sound'),
    btnToggleSoundIcon: document.getElementById('btn-toggle-sound-icon'),
    // BGM
    bgmAudio: document.getElementById('bgm-audio'),
    btnToggleBgm: document.getElementById('btn-toggle-bgm'),
    btnToggleBgmIcon: document.getElementById('btn-toggle-bgm-icon'),
    bgmVolume: document.getElementById('bgm-volume'),
    bgmVolumeLabel: document.getElementById('bgm-volume-label'),
    // セーブデータ管理
    saveModal: document.getElementById('save-modal'),
    saveStatusVal: document.getElementById('save-status-val'),
    btnOpenSaveModal: document.getElementById('btn-open-save-modal'),
    btnCloseSaveModal: document.getElementById('btn-close-save-modal'),
    btnExportJson: document.getElementById('btn-export-json'),
    btnImportJsonTrigger: document.getElementById('btn-import-json-trigger'),
    inputSaveFile: document.getElementById('input-save-file'),
    coopClearCounter: document.getElementById('coop-clear-counter')
  };

  const ctx = DOM.canvas.getContext('2d');

  /* ==========================================================================
     3.4. 2人協力クリア数マネージャー (2人通信プレイ時のみ計上 & localStorage永続保存)
     ========================================================================== */
  const CoopStatsManager = {
    STORAGE_KEY: 'picross_coop_cleared_puzzles_v1',
    clearedSet: new Set(),

    init() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            this.clearedSet = new Set(arr);
          }
        }
      } catch (e) {
        console.warn('Failed to load coop stats:', e);
      }
      this.updateUI();
    },

    getTotalCount() {
      if (window.PICROSS_ICONS && Array.isArray(window.PICROSS_ICONS) && window.PICROSS_ICONS.length > 0) {
        return window.PICROSS_ICONS.length;
      }
      return 4180;
    },

    getClearedCount() {
      return this.clearedSet.size;
    },

    // 2人で協力プレイ中の時だけ記録
    recordClear(puzzleName) {
      if (!puzzleName) return false;
      const isNew = !this.clearedSet.has(puzzleName);
      if (isNew) {
        this.clearedSet.add(puzzleName);
        this.save();
      }
      this.updateUI();
      return isNew;
    },

    mergeList(incomingList) {
      if (!Array.isArray(incomingList)) return;
      let changed = false;
      incomingList.forEach(name => {
        if (name && !this.clearedSet.has(name)) {
          this.clearedSet.add(name);
          changed = true;
        }
      });
      if (changed) {
        this.save();
        this.updateUI();
      }
    },

    save() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(Array.from(this.clearedSet)));
      } catch (e) {
        console.warn('Failed to save coop stats:', e);
      }
    },

    updateUI() {
      const el = document.getElementById('coop-counter-val');
      if (el) {
        const cleared = this.getClearedCount();
        const total = this.getTotalCount();
        // 指定のフォーマット: ◯個分の◯個クリア
        el.textContent = `${total.toLocaleString()}問中 ${cleared.toLocaleString()}問クリア`;
      }
    }
  };

  /* ==========================================================================
     3.45. セーブデータ管理マネージャー (JSONファイル バックアップ / 復元)
     ========================================================================== */
  const SaveDataManager = {
    openModal() {
      if (DOM.saveStatusVal) {
        const cleared = CoopStatsManager.getClearedCount();
        const total = CoopStatsManager.getTotalCount();
        DOM.saveStatusVal.textContent = `${total.toLocaleString()}問中 ${cleared.toLocaleString()}問クリア`;
      }
      if (DOM.saveModal) {
        DOM.saveModal.style.display = 'flex';
      }
    },

    closeModal() {
      if (DOM.saveModal) {
        DOM.saveModal.style.display = 'none';
      }
    },

    exportJson() {
      try {
        const data = {
          appName: 'Picross Co-op',
          version: 1,
          exportedAt: new Date().toISOString(),
          coopClearedCount: CoopStatsManager.getClearedCount(),
          coopClearedPuzzles: Array.from(CoopStatsManager.clearedSet),
          bgmSliderPercent: SoundManager.bgmSliderPercent
        };
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        a.href = url;
        a.download = `picross_save_${y}${m}${d}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('💾 セーブデータをJSONファイルとして保存しました！');
      } catch (e) {
        alert('セーブデータのエクスポートに失敗しました: ' + e.message);
      }
    },

    importJson(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          let list = null;
          if (Array.isArray(parsed)) {
            list = parsed;
          } else if (parsed && Array.isArray(parsed.coopClearedPuzzles)) {
            list = parsed.coopClearedPuzzles;
          } else if (parsed && Array.isArray(parsed.clearedPuzzles)) {
            list = parsed.clearedPuzzles;
          }

          if (!list) {
            alert('セーブデータの形式が正しくありません。正しいJSONファイルを選択してください。');
            return;
          }

          // リストをマージ復元
          CoopStatsManager.mergeList(list);

          if (parsed && typeof parsed.bgmSliderPercent === 'number') {
            SoundManager.setBgmSliderPercent(parsed.bgmSliderPercent);
          }

          // 相手プレイヤーと接続中なら相手端末にも即座に同期
          if (AppState.isConnected) {
            sendNetworkMessage({
              type: 'SYNC_COOP_LIST',
              clearedList: Array.from(CoopStatsManager.clearedSet)
            });
          }

          this.closeModal();
          showToast(`🎉 復元完了！ 協力クリア数: ${CoopStatsManager.getClearedCount()}問`);
        } catch (err) {
          alert('ファイルの読み込みに失敗しました: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  };

  /* ==========================================================================
     3.5. 効果音エンジン (Web Audio API プロシージャル木彫りサウンド)
     ========================================================================== */
  const SoundManager = {
    ctx: null,
    isMuted: false,
    bgmPlaying: false,
    bgmStarting: false,
    bgmSliderPercent: 50,
    wasStoppedByClear: false,
    bgmFadeTimer: null,

    init() {
      // 保存されたスライダー値またはデフォルト50%を反映
      const savedPercent = localStorage.getItem('picross_bgm_slider_percent');
      const percent = (savedPercent !== null) ? parseInt(savedPercent, 10) : 50;
      this.bgmSliderPercent = Math.max(0, Math.min(100, Math.round(percent)));

      if (DOM.bgmVolume) {
        DOM.bgmVolume.value = this.bgmSliderPercent.toString();
      }
      if (DOM.bgmVolumeLabel) {
        DOM.bgmVolumeLabel.textContent = `${this.bgmSliderPercent}%`;
      }

      // 初期音量を設定 (音量0にせず、最初から適正音量に準備)
      this.applyBgmVolume(this.getBgmVolume());
      this.updateBgmIcon();

      // 初回操作によるAudioContext & BGM起動 (iOS Safari では直接 play() が必須)
      const unlockAudio = (e) => {
        const ctx = this.getAudioContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume();
        }

        // 停止中かつクリア状態でなければBGM再生を開始
        if (DOM.bgmAudio && DOM.bgmAudio.paused && !AppState.isSolved && this.bgmSliderPercent > 0) {
          this.startBgm().then((started) => {
            if (started) {
              window.removeEventListener('pointerdown', unlockAudio, true);
              window.removeEventListener('touchstart', unlockAudio, true);
              window.removeEventListener('click', unlockAudio, true);
              window.removeEventListener('keydown', unlockAudio, true);
            }
          });
        }
      };

      window.addEventListener('pointerdown', unlockAudio, { capture: true });
      window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
      window.addEventListener('click', unlockAudio, { capture: true });
      window.addEventListener('keydown', unlockAudio, { capture: true });

      // audioタグ自身のイベントを監視して常に状態を完全同期
      if (DOM.bgmAudio) {
        DOM.bgmAudio.addEventListener('play', () => {
          this.bgmPlaying = true;
          this.updateBgmIcon();
        });
        DOM.bgmAudio.addEventListener('pause', () => {
          this.bgmPlaying = false;
          this.updateBgmIcon();
        });
        DOM.bgmAudio.addEventListener('ended', () => {
          this.bgmPlaying = false;
          this.updateBgmIcon();
        });
      }
    },

    getAudioContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      return this.ctx;
    },

    getBgmVolume() {
      const userAgent = navigator.userAgent || '';
      const isAndroid = /Android/i.test(userAgent);
      const isIPad = /iPad/i.test(userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      // iPadはスピーカー出力が強いため上限0.07、Androidは0.45、PCは0.35に設定
      const maxVolume = isAndroid ? 0.45 : (isIPad ? 0.07 : 0.35);
      return (this.bgmSliderPercent / 100) * maxVolume;
    },

    applyBgmVolume(volume) {
      const vol = Math.max(0, Math.min(1, volume));
      if (DOM.bgmAudio) {
        try {
          DOM.bgmAudio.volume = vol;
        } catch (e) {}
      }
    },

    getCurrentBgmVolume() {
      if (DOM.bgmAudio) {
        return DOM.bgmAudio.volume;
      }
      return this.getBgmVolume();
    },

    updateBgmIcon() {
      if (!DOM.btnToggleBgm) return;
      const isPlaying = DOM.bgmAudio ? !DOM.bgmAudio.paused : this.bgmPlaying;
      if (isPlaying) {
        if (DOM.btnToggleBgmIcon) DOM.btnToggleBgmIcon.textContent = '🎵';
        DOM.btnToggleBgm.style.opacity = '1';
      } else {
        if (DOM.btnToggleBgmIcon) DOM.btnToggleBgmIcon.textContent = '🎵';
        DOM.btnToggleBgm.style.opacity = '0.4';
      }
    },

    cancelBgmFade() {
      if (this.bgmFadeTimer) {
        clearInterval(this.bgmFadeTimer);
        this.bgmFadeTimer = null;
      }
    },

    fadeBgmVolumeTo(targetVolume, durationMs = 1800) {
      this.cancelBgmFade();
      const startVolume = this.getCurrentBgmVolume();
      const startTime = performance.now();

      this.bgmFadeTimer = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = startVolume + (targetVolume - startVolume) * ease;
        this.applyBgmVolume(current);
        if (progress >= 1) {
          this.cancelBgmFade();
          this.applyBgmVolume(targetVolume);
        }
      }, 30);
    },

    setBgmSliderPercent(percent) {
      this.cancelBgmFade();
      this.bgmSliderPercent = Math.max(0, Math.min(100, Math.round(percent)));
      const actualVolume = this.getBgmVolume();

      this.applyBgmVolume(this.isDuckedForClear ? (actualVolume * 0.3) : actualVolume);

      if (DOM.bgmVolume) {
        DOM.bgmVolume.value = this.bgmSliderPercent.toString();
      }
      if (DOM.bgmVolumeLabel) {
        DOM.bgmVolumeLabel.textContent = `${this.bgmSliderPercent}%`;
      }
      try {
        localStorage.setItem('picross_bgm_slider_percent', this.bgmSliderPercent.toString());
      } catch (e) {}

      // 音量が0より大きく、停止中かつクリア状態でなければ自動再生
      if (this.bgmSliderPercent > 0 && (!DOM.bgmAudio || DOM.bgmAudio.paused) && !AppState.isSolved) {
        this.startBgm();
      }
    },

    startBgm() {
      if (!DOM.bgmAudio || this.bgmStarting) {
        return Promise.resolve(DOM.bgmAudio ? !DOM.bgmAudio.paused : false);
      }
      // すでに再生中なら何もしない
      if (!DOM.bgmAudio.paused) {
        this.bgmPlaying = true;
        this.updateBgmIcon();
        return Promise.resolve(true);
      }

      this.bgmStarting = true;
      const actualVolume = this.isDuckedForClear ? (this.getBgmVolume() * 0.3) : this.getBgmVolume();
      this.applyBgmVolume(actualVolume);

      return DOM.bgmAudio.play().then(() => {
        this.bgmPlaying = true;
        this.isDuckedForClear = false;
        this.applyBgmVolume(actualVolume);
        this.updateBgmIcon();
        return true;
      }).catch((err) => {
        console.warn('BGM play rejected:', err);
        this.bgmPlaying = false;
        this.updateBgmIcon();
        return false;
      }).finally(() => {
        this.bgmStarting = false;
      });
    },

    // ★クリア時に音楽を無音ではなく「約30%」の音量に落とす (ダッキング)★
    duckBgmForClear() {
      this.cancelBgmFade();
      if (DOM.bgmAudio && !DOM.bgmAudio.paused) {
        this.isDuckedForClear = true;
        const normalVolume = this.getBgmVolume();
        this.applyBgmVolume(normalVolume * 0.3);
      }
    },

    // ★次の問題開始時に音楽の音量を徐々に100%に復帰 (フェードイン)★
    resumeBgmAfterClear() {
      const normalVolume = this.getBgmVolume();
      if (this.isDuckedForClear) {
        this.isDuckedForClear = false;
        if (DOM.bgmAudio && !DOM.bgmAudio.paused) {
          this.fadeBgmVolumeTo(normalVolume, 1800);
        }
      } else if (DOM.bgmAudio && !DOM.bgmAudio.paused) {
        this.applyBgmVolume(normalVolume);
      }
    },

    toggleBgm() {
      this.cancelBgmFade();
      if (!DOM.bgmAudio) return;

      // 実際の再生状態 (DOM.bgmAudio.paused) を直接判定！
      const isCurrentlyPlaying = !DOM.bgmAudio.paused;

      if (isCurrentlyPlaying) {
        DOM.bgmAudio.pause();
        this.bgmPlaying = false;
        this.wasStoppedByClear = false;
        this.updateBgmIcon();
        showToast('BGMを一時停止しました');
      } else {
        // 停止中なら即座に1回で再生！
        if (this.bgmSliderPercent <= 0) {
          this.setBgmSliderPercent(50);
        }
        this.startBgm().then((started) => {
          if (started) {
            showToast('BGMを再生しました');
          } else {
            showToast('BGMの再生に失敗しました（画面をタップしてください）');
          }
        });
      }
    },

    toggleMute() {
      this.isMuted = !this.isMuted;
      if (DOM.btnToggleSoundIcon) {
        DOM.btnToggleSoundIcon.textContent = this.isMuted ? '🔇' : '🔊';
      }
      showToast(this.isMuted ? '効果音をOFFにしました' : '効果音をONにしました');
      return this.isMuted;
    },

    // マス編集時の木彫り効果音
    playWoodChisel(targetState) {
      if (this.isMuted) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      // 連続で彫った際に機械的にならず、自然な木目の揺らぎを出す (±7%)
      const jitter = 0.93 + Math.random() * 0.14;

      if (targetState === 1) {
        // ★【塗る (木を彫る)】: 低めで心地よい木製打撃・彫刻音「トッ」「コンッ」★
        // 1. 基音オシレーター (ピッチ降下: 220Hz -> 125Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(125 * jitter, now + 0.035);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.42, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);

        // 2. 木の繊維の温かい倍音 (三角波: 170Hz -> 105Hz)
        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = 'triangle';
        subOsc.frequency.setValueAtTime(170 * jitter, now);
        subOsc.frequency.exponentialRampToValueAtTime(105 * jitter, now + 0.04);

        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(0.18, now + 0.002);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

        subOsc.connect(subGain);
        subGain.connect(ctx.destination);
        subOsc.start(now);
        subOsc.stop(now + 0.06);

        // 3. 刃先が木に当たった瞬間の木質アタックノイズ (12ms)
        this.playWoodCrack(ctx, now, jitter);

      } else if (targetState === 2) {
        // ★【✕印】: 軽快な木製マーキング音「コツッ」★
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(200 * jitter, now + 0.02);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);

      } else {
        // ★【消す】: 削りカスをサッと払うような柔らかい低音「ポッ」★
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(95 * jitter, now + 0.025);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.045);
      }
    },

    // 木材打撃特有の「カッ」という瞬間的な木質アタックノイズ
    playWoodCrack(ctx, now, jitter) {
      try {
        const bufferSize = Math.floor(ctx.sampleRate * 0.012); // 12ms
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
        }

        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(560 * jitter, now);
        filter.Q.setValueAtTime(3.2, now);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        noise.start(now);
        noise.stop(now + 0.013);
      } catch (e) {
        // 安全措置
      }
    },

    // ★クリア時の華やかな祝賀ファンファーレチャイム★
    playClearChime() {
      if (this.isMuted) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      const notes = [
        { freq: 261.63, delay: 0.00, dur: 0.40, gain: 0.22, type: 'sine' },      // C4
        { freq: 329.63, delay: 0.08, dur: 0.40, gain: 0.22, type: 'sine' },      // E4
        { freq: 392.00, delay: 0.16, dur: 0.45, gain: 0.24, type: 'sine' },      // G4
        { freq: 523.25, delay: 0.24, dur: 0.65, gain: 0.28, type: 'sine' },      // C5
        { freq: 659.25, delay: 0.32, dur: 0.70, gain: 0.26, type: 'triangle' },  // E5
        { freq: 783.99, delay: 0.40, dur: 0.80, gain: 0.28, type: 'triangle' },  // G5
        { freq: 1046.50, delay: 0.48, dur: 1.10, gain: 0.30, type: 'sine' },     // C6 (主音高音ベル)
        // 煌めくベル装飾
        { freq: 1318.51, delay: 0.54, dur: 0.85, gain: 0.16, type: 'sine' },     // E6
        { freq: 2093.00, delay: 0.60, dur: 0.95, gain: 0.12, type: 'sine' }      // C7
      ];

      notes.forEach(({ freq, delay, dur, gain: maxGain, type }) => {
        const time = now + delay;
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);

        gainNode.gain.setValueAtTime(0.0001, time);
        gainNode.gain.linearRampToValueAtTime(maxGain, time + 0.006);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(time);
        osc.stop(time + dur + 0.05);
      });
    }
  };

  /* ==========================================================================
     4. ベクターパス(Path2D)からの超高速・Taintedフリー動的ピクロス生成エンジン
     ========================================================================== */
  // アイコンの実体範囲（バウンディングボックス）計測用キャンバス（キャッシュして再利用）
  let measureCanvas = null;
  let measureCtx = null;
  const MEASURE_SIZE = 128;

  function getPathBoundingBox(path2d) {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
      measureCanvas.width = MEASURE_SIZE;
      measureCanvas.height = MEASURE_SIZE;
      measureCtx = measureCanvas.getContext('2d', { willReadFrequently: true });
    }

    measureCtx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    measureCtx.save();
    measureCtx.scale(MEASURE_SIZE / 512, MEASURE_SIZE / 512);
    measureCtx.fillStyle = '#000000';
    measureCtx.fill(path2d);
    measureCtx.restore();

    const imgData = measureCtx.getImageData(0, 0, MEASURE_SIZE, MEASURE_SIZE).data;
    let minX = MEASURE_SIZE, maxX = -1;
    let minY = MEASURE_SIZE, maxY = -1;

    for (let y = 0; y < MEASURE_SIZE; y++) {
      for (let x = 0; x < MEASURE_SIZE; x++) {
        const alpha = imgData[(y * MEASURE_SIZE + x) * 4 + 3];
        if (alpha > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // 検出不能時は512全体
    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, w: 512, h: 512, cx: 256, cy: 256, maxSpan: 512 };
    }

    const factor = 512 / MEASURE_SIZE;
    const x = minX * factor;
    const y = minY * factor;
    const w = Math.max(1, (maxX - minX + 1) * factor);
    const h = Math.max(1, (maxY - minY + 1) * factor);
    return {
      x,
      y,
      w,
      h,
      cx: x + w / 2,
      cy: y + h / 2,
      maxSpan: Math.max(w, h)
    };
  }

  function generatePicrossFromPathData(dString, size) {
    const path2d = new Path2D(dString);
    const bbox = getPathBoundingBox(path2d);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = size;
    offCanvas.height = size;
    const offCtx = offCanvas.getContext('2d');

    // 白背景で初期化
    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, size, size);

    // 外周のマスが0（全空白）になるのを防ぐため、アイコンの実体サイズに合わせて盤面いっぱいにズーム＆中央配置
    // 端の見切れを防ぐわずかなマージン（約0.4〜0.8マス）を残して最大拡大
    const margin = Math.max(0.4, size * 0.04);
    const targetSpan = size - margin * 2;
    const fitScale = targetSpan / bbox.maxSpan;

    offCtx.save();
    offCtx.translate(size / 2, size / 2);
    offCtx.scale(fitScale, fitScale);
    offCtx.translate(-bbox.cx, -bbox.cy);
    offCtx.fillStyle = '#000000';
    offCtx.fill(path2d);
    offCtx.restore();

    // ピクセル輝度から二値化
    const imgData = offCtx.getImageData(0, 0, size, size).data;
    const gridData = [];
    let filledCount = 0;

    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        const idx = (r * size + c) * 4;
        const red = imgData[idx];
        const green = imgData[idx + 1];
        const blue = imgData[idx + 2];
        const lum = 0.299 * red + 0.587 * green + 0.114 * blue;

        // 輝度が160未満なら黒（塗り）
        const isFilled = lum < 160 ? 1 : 0;
        if (isFilled) filledCount++;
        row.push(isFilled);
      }
      gridData.push(row);
    }

    const fillRatio = filledCount / (size * size);
    return {
      gridData,
      fillRatio,
      path2d,
      transform: {
        cx: bbox.cx,
        cy: bbox.cy,
        fitScale: fitScale
      }
    };
  }

  /* --------------------------------------------------------------------------
     一意解判定ロジック (ラインソルバー: 仮定・推測なしで100%解けるか検証)
     -------------------------------------------------------------------------- */
  function getValidLinePlacements(currentLine, hints, length) {
    if (hints.length === 1 && hints[0] === 0) {
      for (let i = 0; i < length; i++) {
        if (currentLine[i] === 1) return []; // 塗り確定と矛盾
      }
      return [Array(length).fill(2)];
    }

    const validLines = [];
    function helper(hintIdx, pos, lineArr) {
      if (hintIdx === hints.length) {
        const fullLine = [...lineArr];
        while (fullLine.length < length) fullLine.push(2);
        for (let i = 0; i < length; i++) {
          if (currentLine[i] !== 0 && currentLine[i] !== fullLine[i]) return;
        }
        validLines.push(fullLine);
        return;
      }

      if (validLines.length > 250) return; // 30x30等の組み合わせ爆発・フリーズ防止

      const blockSize = hints[hintIdx];
      let remainingNeeded = 0;
      for (let i = hintIdx; i < hints.length; i++) {
        remainingNeeded += hints[i] + (i > hintIdx ? 1 : 0);
      }

      const maxStart = length - remainingNeeded;
      for (let start = pos; start <= maxStart; start++) {
        let canPlace = true;
        const nextArr = [...lineArr];
        while (nextArr.length < start) {
          const idx = nextArr.length;
          if (currentLine[idx] === 1) { canPlace = false; break; }
          nextArr.push(2);
        }
        if (!canPlace) continue;

        for (let i = 0; i < blockSize; i++) {
          const idx = start + i;
          if (currentLine[idx] === 2) { canPlace = false; break; }
          nextArr.push(1);
        }
        if (!canPlace) continue;

        if (hintIdx < hints.length - 1) {
          const separatorIdx = start + blockSize;
          if (currentLine[separatorIdx] === 1) continue;
          nextArr.push(2);
          helper(hintIdx + 1, separatorIdx + 1, nextArr);
        } else {
          helper(hintIdx + 1, start + blockSize, nextArr);
        }
      }
    }

    helper(0, 0, []);
    return validLines;
  }

  function solveSingleLine(currentLine, hints, length) {
    const validPlacements = getValidLinePlacements(currentLine, hints, length);
    if (!validPlacements || validPlacements.length === 0) return null; // 矛盾

    const result = Array(length).fill(0);
    for (let i = 0; i < length; i++) {
      const firstVal = validPlacements[0][i];
      let allSame = true;
      for (let p = 1; p < validPlacements.length; p++) {
        if (validPlacements[p][i] !== firstVal) {
          allSame = false;
          break;
        }
      }
      if (allSame) result[i] = firstVal;
    }
    return result;
  }

  function isLogicallySolvable(solutionGrid, width, height) {
    const { rowHints, colHints } = computeHints({ width, height, data: solutionGrid });
    // 0: 未確定, 1: 塗り確定, 2: バツ確定
    const board = Array.from({ length: height }, () => Array(width).fill(0));

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 35) {
      changed = false;
      iterations++;

      // 行のチェック
      for (let r = 0; r < height; r++) {
        const newLine = solveSingleLine(board[r], rowHints[r], width);
        if (!newLine) return false;
        for (let c = 0; c < width; c++) {
          if (board[r][c] === 0 && newLine[c] !== 0) {
            board[r][c] = newLine[c];
            changed = true;
          }
        }
      }

      // 列のチェック
      for (let c = 0; c < width; c++) {
        const colLine = [];
        for (let r = 0; r < height; r++) colLine.push(board[r][c]);
        const newLine = solveSingleLine(colLine, colHints[c], height);
        if (!newLine) return false;
        for (let r = 0; r < height; r++) {
          if (board[r][c] === 0 && newLine[r] !== 0) {
            board[r][c] = newLine[r];
            changed = true;
          }
        }
      }
    }

    // 全マスが推測なしで確定できたか確認
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (board[r][c] === 0) return false; // 推測が必要
      }
    }
    return true; // 完全論理解法可能！
  }

  // ランダムにアイコンを選択して「推測なしで論理的に解ける問題」を厳選出題
  function pickRandomPuzzle(targetSize) {
    const icons = window.PICROSS_ICONS;
    if (!icons || !Array.isArray(icons) || icons.length === 0) {
      const fb = FALLBACK_PUZZLES[Math.floor(Math.random() * FALLBACK_PUZZLES.length)];
      return {
        name: fb.name,
        width: fb.width,
        height: fb.height,
        data: fb.data,
        pathData: null,
        path2d: null
      };
    }

    // ★未クリアの問題を優先出題プールとして選定★
    const clearedSet = CoopStatsManager.clearedSet;
    let pool = icons.filter(icon => !clearedSet.has(icon.name));
    if (pool.length === 0) {
      // 全てクリア済みの場合は全問から再出題
      pool = icons;
    }

    let bestCandidate = null;

    // 「推測なしで100%解ける（一意解）」パズルを探索 (大きい盤面は試行回数を抑えて瞬時出題)
    const maxTries = targetSize >= 25 ? 12 : 35;
    for (let i = 0; i < maxTries; i++) {
      const icon = pool[Math.floor(Math.random() * pool.length)];
      try {
        const result = generatePicrossFromPathData(icon.d, targetSize);
        if (result.fillRatio < 0.15 || result.fillRatio > 0.75) {
          continue;
        }

        // 一意解検証 (Line Solver)
        const solvable = isLogicallySolvable(result.gridData, targetSize, targetSize);
        if (solvable) {
          console.log(`[Solver] 100% solvable puzzle found: "${icon.name}" (${targetSize}x${targetSize}) in ${i + 1} attempt(s)`);
          return {
            name: icon.name,
            width: targetSize,
            height: targetSize,
            data: result.gridData,
            pathData: icon.d,
            path2d: result.path2d,
            transform: result.transform,
            verified: true
          };
        }

        if (!bestCandidate) {
          bestCandidate = {
            name: icon.name,
            width: targetSize,
            height: targetSize,
            data: result.gridData,
            pathData: icon.d,
            path2d: result.path2d,
            transform: result.transform,
            verified: false
          };
        }
      } catch (e) {
        console.warn('Pick retry:', e);
      }
    }

    console.log(`[Solver] Fallback to candidate: "${bestCandidate.name}"`);
    return bestCandidate || FALLBACK_PUZZLES[0];
  }

  /* ==========================================================================
     5. ヒント計算 & パズル適用ロジック
     ========================================================================== */
  function computeHints(puzzle) {
    const rowHints = [];
    for (let r = 0; r < puzzle.height; r++) {
      const hints = [];
      let count = 0;
      for (let c = 0; c < puzzle.width; c++) {
        if (puzzle.data[r][c] === 1) {
          count++;
        } else if (count > 0) {
          hints.push(count);
          count = 0;
        }
      }
      if (count > 0) hints.push(count);
      rowHints.push(hints.length > 0 ? hints : [0]);
    }

    const colHints = [];
    for (let c = 0; c < puzzle.width; c++) {
      const hints = [];
      let count = 0;
      for (let r = 0; r < puzzle.height; r++) {
        if (puzzle.data[r][c] === 1) {
          count++;
        } else if (count > 0) {
          hints.push(count);
          count = 0;
        }
      }
      if (count > 0) hints.push(count);
      colHints.push(hints.length > 0 ? hints : [0]);
    }

    return { rowHints, colHints };
  }

  function applyLoadedPuzzle(puzzle, shouldNotify = true) {
    AppState.puzzle = puzzle;
    // path2dの復元
    if (puzzle.pathData && !puzzle.path2d) {
      puzzle.path2d = new Path2D(puzzle.pathData);
    }

    const { rowHints, colHints } = computeHints(puzzle);
    AppState.rowHints = rowHints;
    AppState.colHints = colHints;
    AppState.isSolved = false;

    // ヒント表示エリア計算
    const maxRowHintCount = Math.max(...rowHints.map(h => h.length));
    const maxColHintCount = Math.max(...colHints.map(h => h.length));
    AppState.camera.hintWidth = Math.max(80, maxRowHintCount * 20 + 20);
    AppState.camera.hintHeight = Math.max(65, maxColHintCount * 20 + 16);

    // 空グリッド初期化
    AppState.grid = [];
    for (let r = 0; r < puzzle.height; r++) {
      const row = [];
      for (let c = 0; c < puzzle.width; c++) {
        row.push({ state: 0, by: null });
      }
      AppState.grid.push(row);
    }

    // UIリセット
    AppState.viewModeInClear = 'board'; // クリア時は完成盤面のまま保持
    AppState.titleRevealed = false;
    if (DOM.clearPuzzleTitle) {
      DOM.clearPuzzleTitle.textContent = '???';
      DOM.clearPuzzleTitle.classList.remove('revealed');
    }
    if (DOM.btnToggleViewText) {
      DOM.btnToggleViewText.textContent = '答えを見る';
      DOM.btnToggleViewIcon.textContent = '🖼️';
    }
    DOM.clearBanner.classList.remove('show');
    DOM.toolbar.style.opacity = '1';
    DOM.toolbar.style.pointerEvents = 'auto';

    // クリアでダッキングしていたBGMを徐々に通常音量へ復帰 (フェードイン)
    SoundManager.resumeBgmAfterClear();
    particles.length = 0;

    resetView();

    // ホストかつ接続中の場合は相手に同期
    if (AppState.isHost && AppState.conn && AppState.isConnected && shouldNotify) {
      sendNetworkMessage({
        type: 'INIT_GAME',
        puzzle: {
          name: puzzle.name,
          width: puzzle.width,
          height: puzzle.height,
          data: puzzle.data,
          pathData: puzzle.pathData,
          transform: puzzle.transform || null
        },
        size: AppState.currentSize,
        grid: AppState.grid,
        isSolved: false
      });
    }
  }

  // 新しいランダム問題を開始
  function startNewRandomPuzzle(size = AppState.currentSize) {
    AppState.currentSize = size;
    DOM.selectBoardSize.value = size.toString();

    try {
      const puzzle = pickRandomPuzzle(size);
      applyLoadedPuzzle(puzzle, true);
      const verifiedTag = puzzle.verified ? ' (✓論理的に解ける問題)' : '';
      showToast(`問題「${puzzle.name}」(${size}×${size})${verifiedTag}`);
    } catch (e) {
      console.error('Failed to create puzzle:', e);
      applyLoadedPuzzle(FALLBACK_PUZZLES[0], true);
      showToast('フォールバック問題を開始しました');
    }
  }

  /* クリア判定 */
  function checkPuzzleSolved() {
    if (AppState.isSolved || !AppState.puzzle) return true;
    const { puzzle, grid } = AppState;
    for (let r = 0; r < puzzle.height; r++) {
      for (let c = 0; c < puzzle.width; c++) {
        const isSolutionFilled = puzzle.data[r][c] === 1;
        const isUserFilled = grid[r][c].state === 1;
        if (isSolutionFilled !== isUserFilled) {
          return false;
        }
      }
    }
    // クリア達成！
    AppState.isSolved = true;
    triggerClearCelebration();
    return true;
  }

  function revealPuzzleTitle() {
    if (AppState.titleRevealed) return;
    AppState.titleRevealed = true;
    if (DOM.clearPuzzleTitle && AppState.puzzle) {
      DOM.clearPuzzleTitle.textContent = AppState.puzzle.name;
      DOM.clearPuzzleTitle.classList.add('revealed');
    }
    showToast(`✨ 正解は「${AppState.puzzle.name}」！`);
  }

  function triggerClearCelebration() {
    AppState.clearAnim.startTime = performance.now();
    AppState.viewModeInClear = 'board'; // まずは完成盤面(ドット絵)を表示
    AppState.titleRevealed = false; // 元画像が表示されきるまでタイトルは伏せておく（ネタバレ防止）
    if (DOM.btnToggleViewText) {
      DOM.btnToggleViewText.textContent = '答えを見る';
      DOM.btnToggleViewIcon.textContent = '🖼️';
    }
    if (DOM.clearPuzzleTitle) {
      DOM.clearPuzzleTitle.textContent = '???';
      DOM.clearPuzzleTitle.classList.remove('revealed');
    }
    DOM.clearBanner.classList.add('show');
    DOM.toolbar.style.opacity = '0';
    DOM.toolbar.style.pointerEvents = 'none';

    triggerGrandCelebration();
    SoundManager.duckBgmForClear(); // BGMを約30%にダッキング
    SoundManager.playClearChime();

    // ★2人で協力プレイ中（相手と接続中）の場合のみ、協力クリア数を計上＆永続保存★
    if (AppState.isConnected && AppState.puzzle) {
      CoopStatsManager.recordClear(AppState.puzzle.name);

      // 相手端末へもリストを送信して相互同期
      sendNetworkMessage({
        type: 'SYNC_COOP_LIST',
        clearedList: Array.from(CoopStatsManager.clearedSet)
      });
    }

    // 元のポップアップと重複しないよう「✨ STAGE CLEAR! ✨」のみを表示し、次のポップアップが出るまで残す
    showToast('✨ STAGE CLEAR! ✨', true, true);
  }

  function toggleClearViewMode() {
    AppState.viewModeInClear = (AppState.viewModeInClear === 'image') ? 'board' : 'image';
    const isImage = (AppState.viewModeInClear === 'image');
    if (isImage) {
      AppState.clearAnim.startTime = performance.now();
    }
    if (DOM.btnToggleViewText) {
      DOM.btnToggleViewText.textContent = isImage ? '盤面表示' : '答えを見る';
      DOM.btnToggleViewIcon.textContent = isImage ? '▦' : '🖼️';
    }
    showToast(isImage ? '答えの元画像を表示中...' : '完成盤面を表示中');
  }

  /* ==========================================================================
     6. PeerJS 通信・同期制御 (Master/Worker & 固定URL方式)
     ========================================================================== */
  function getCleanRoomId() {
    const rawHash = window.location.hash.replace(/^#/, '').trim();
    if (!rawHash) return null;
    return rawHash.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function generateRoomId() {
    return 'room_' + Math.random().toString(36).substring(2, 8);
  }

  function initNetwork() {
    const roomId = getCleanRoomId();
    if (!roomId) {
      DOM.welcomeModal.style.display = 'flex';
      updateUIStatus('waiting', '部屋IDが指定されていません');
      return;
    }

    AppState.roomId = roomId;
    DOM.welcomeModal.style.display = 'none';

    const hostPeerId = `picross-p2p-${roomId}-host`;
    updateUIStatus('connecting', 'ホスト接続を試行中...');

    let hostPeer = null;
    try {
      hostPeer = new Peer(hostPeerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
    } catch (e) {
      console.error('Peer init error:', e);
      return;
    }

    hostPeer.on('open', () => {
      AppState.peer = hostPeer;
      AppState.isHost = true;
      setRoleUI(true);
      updateUIStatus('waiting', 'ホスト待機中 (相手の参加待ち)');
      showToast('ホストとして部屋を作成しました。URLを共有してください。');

      hostPeer.on('connection', (conn) => {
        handleIncomingConnection(conn);
      });
    });

    hostPeer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        console.log('Host already exists. Joining room as guest...');
        hostPeer.destroy();
        initAsGuest(hostPeerId);
      } else {
        console.error('PeerJS error:', err);
        updateUIStatus('error', `通信エラー: ${err.type}`);
      }
    });
  }

  function initAsGuest(hostPeerId) {
    AppState.isHost = false;
    setRoleUI(false);
    updateUIStatus('connecting', 'ゲストとしてホストへ接続中...');

    const guestPeer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    guestPeer.on('open', () => {
      AppState.peer = guestPeer;
      const conn = guestPeer.connect(hostPeerId, { reliable: true });
      setupConnectionHandlers(conn);
    });

    guestPeer.on('error', (err) => {
      console.error('Guest Peer error:', err);
      updateUIStatus('error', 'ホストへの接続に失敗しました');
    });
  }

  function handleIncomingConnection(conn) {
    if (AppState.conn) {
      AppState.conn.close();
    }
    setupConnectionHandlers(conn);
  }

  function setupConnectionHandlers(conn) {
    AppState.conn = conn;

    conn.on('open', () => {
      AppState.isConnected = true;
      updateUIStatus('online', 'P2P接続完了 (2人プレイ中)');
      showToast('相手と接続しました！同期を開始します。');

      // 接続時にお互いの協力クリア記録を相互同期
      sendNetworkMessage({
        type: 'SYNC_COOP_LIST',
        clearedList: Array.from(CoopStatsManager.clearedSet)
      });

      if (!AppState.isHost) {
        sendNetworkMessage({
          type: 'JOIN',
          info: 'iPad/Guest joined'
        });
      } else {
        if (AppState.puzzle) {
          sendNetworkMessage({
            type: 'INIT_GAME',
            puzzle: {
              name: AppState.puzzle.name,
              width: AppState.puzzle.width,
              height: AppState.puzzle.height,
              data: AppState.puzzle.data,
              pathData: AppState.puzzle.pathData
            },
            size: AppState.currentSize,
            grid: AppState.grid,
            isSolved: AppState.isSolved
          });
        }
        startHeartbeatSync();
      }
    });

    conn.on('data', (raw) => {
      handleNetworkMessage(raw);
    });

    conn.on('close', () => {
      AppState.isConnected = false;
      stopHeartbeatSync();
      updateUIStatus('waiting', AppState.isHost ? 'ゲストが退出しました (待機中)' : 'ホストとの接続が切れました');
      showToast('通信が切断されました');
      AppState.remoteCursor.active = false;
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
    });
  }

  function sendNetworkMessage(msg) {
    if (AppState.conn && AppState.conn.open) {
      try {
        AppState.conn.send(msg);
      } catch (e) {
        console.warn('Failed to send message:', e);
      }
    }
  }

  function startHeartbeatSync() {
    stopHeartbeatSync();
    AppState.heartbeatInterval = setInterval(() => {
      if (AppState.isHost && AppState.conn && AppState.conn.open && AppState.puzzle) {
        sendNetworkMessage({
          type: 'SYNC_STATE',
          size: AppState.currentSize,
          grid: AppState.grid,
          isSolved: AppState.isSolved
        });
      }
    }, 3000);
  }

  function stopHeartbeatSync() {
    if (AppState.heartbeatInterval) {
      clearInterval(AppState.heartbeatInterval);
      AppState.heartbeatInterval = null;
    }
  }

  function handleNetworkMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'JOIN':
        if (AppState.isHost && AppState.puzzle) {
          sendNetworkMessage({
            type: 'INIT_GAME',
            puzzle: {
              name: AppState.puzzle.name,
              width: AppState.puzzle.width,
              height: AppState.puzzle.height,
              data: AppState.puzzle.data,
              pathData: AppState.puzzle.pathData,
              transform: AppState.puzzle.transform || null
            },
            size: AppState.currentSize,
            grid: AppState.grid,
            isSolved: AppState.isSolved
          });
          showToast('ゲストが参加しました！');
        }
        break;

      case 'INIT_GAME':
        if (msg.puzzle) {
          AppState.currentSize = msg.size || msg.puzzle.width;
          DOM.selectBoardSize.value = AppState.currentSize.toString();
          applyLoadedPuzzle(msg.puzzle, false);
          if (Array.isArray(msg.grid)) {
            AppState.grid = msg.grid;
          }
          if (msg.isSolved) {
            AppState.isSolved = true;
            triggerClearCelebration();
          }
        }
        break;

      case 'PLAYER_ACTION':
        if (typeof msg.targetState === 'number') {
          applyCellExplicit(msg.row, msg.col, msg.targetState, msg.player, false);
        } else if (msg.tool) {
          applyCellAction(msg.row, msg.col, msg.tool, msg.player, false);
        }
        break;

      case 'CURSOR_MOVE':
        AppState.remoteCursor.active = true;
        AppState.remoteCursor.row = msg.row;
        AppState.remoteCursor.col = msg.col;
        AppState.remoteCursor.worldX = msg.worldX;
        AppState.remoteCursor.worldY = msg.worldY;
        AppState.remoteCursor.lastUpdate = Date.now();
        break;

      case 'SYNC_STATE':
        if (!AppState.isHost) {
          if (Array.isArray(msg.grid)) {
            AppState.grid = msg.grid;
          }
          if (msg.isSolved && !AppState.isSolved) {
            AppState.isSolved = true;
            triggerClearCelebration();
          }
        }
        break;

      case 'REQUEST_NEXT_PUZZLE':
        if (AppState.isHost) {
          startNewRandomPuzzle(AppState.currentSize);
          showToast('ゲストのリクエストで新しい問題を開始しました');
        }
        break;

      case 'REQUEST_SIZE_CHANGE':
        if (AppState.isHost) {
          const newSize = parseInt(msg.size);
          if ([5, 10, 15, 20, 25, 30].includes(newSize)) {
            startNewRandomPuzzle(newSize);
            showToast(`ゲストのリクエストでサイズを ${newSize}×${newSize} に変更しました`);
          }
        }
        break;

      case 'SYNC_COOP_LIST':
        if (Array.isArray(msg.clearedList)) {
          CoopStatsManager.mergeList(msg.clearedList);
        }
        break;

      default:
        break;
    }
  }

  /* ==========================================================================
     7. セル操作とMaster/Worker競合解決
     ========================================================================== */
  function applyCellExplicit(row, col, targetState, player, isLocal = true) {
    if (!AppState.puzzle || row < 0 || row >= AppState.puzzle.height || col < 0 || col >= AppState.puzzle.width) {
      return;
    }

    const currentCell = AppState.grid[row][col];
    if (currentCell.state === targetState) {
      return;
    }

    AppState.grid[row][col] = {
      state: targetState,
      by: targetState !== 0 ? player : null
    };

    // 木を掘る低めの効果音を再生
    SoundManager.playWoodChisel(targetState);

    if (isLocal) {
      sendNetworkMessage({
        type: 'PLAYER_ACTION',
        row: row,
        col: col,
        targetState: targetState,
        player: AppState.isHost ? 'host' : 'guest'
      });
    }

    checkPuzzleSolved();
  }

  function applyCellAction(row, col, tool, player, isLocal = true) {
    if (!AppState.puzzle || row < 0 || row >= AppState.puzzle.height || col < 0 || col >= AppState.puzzle.width) {
      return;
    }

    const currentCell = AppState.grid[row][col];
    let nextState = 0;

    if (tool === 'fill') {
      nextState = (currentCell.state === 1) ? 0 : 1;
    } else if (tool === 'cross') {
      nextState = (currentCell.state === 2) ? 0 : 2;
    } else if (tool === 'clear') {
      nextState = 0;
    }

    applyCellExplicit(row, col, nextState, player, isLocal);
  }

  /* ==========================================================================
     8. iPad / タッチ & マウス入力制御 (完全抑止 & パン・ピンチズーム)
     ========================================================================== */
  const InputManager = {
    isPointerDown: false,
    isPanning: false,
    activeTouches: new Map(),
    initialPinchDist: 0,
    initialCameraScale: 1,
    initialCameraOffset: { x: 0, y: 0 },
    initialPinchCenter: { x: 0, y: 0 },
    lastMousePos: { x: 0, y: 0 },
    dragTool: null,
    dragTargetValue: null,
    lastRow: -1,
    lastCol: -1,
    lastSentCursorTime: 0,
    pressedKeys: new Set(),
    activeArrowKey: null,
    arrowInitialTimeout: null,
    arrowRepeatTimer: null,
    outsideTapCandidate: false,
    outsideTapStart: { x: 0, y: 0 },

    init() {
      window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
      }, { capture: true });

      document.body.addEventListener('touchmove', (e) => {
        if (e.target === DOM.canvas || DOM.canvas.contains(e.target)) {
          e.preventDefault();
        }
      }, { passive: false });

      const c = DOM.canvas;
      c.addEventListener('mousedown', this.handleMouseDown.bind(this));
      window.addEventListener('mousemove', this.handleMouseMove.bind(this));
      window.addEventListener('mouseup', this.handleMouseUp.bind(this));
      c.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

      c.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
      c.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
      c.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
      c.addEventListener('touchcancel', this.handleTouchEnd.bind(this), { passive: false });

      // キーボード操作 (D+矢印: 塗る / F+矢印: バツ / S+矢印: 消す / 矢印単体: 移動)
      window.addEventListener('keydown', this.handleKeyDown.bind(this));
      window.addEventListener('keyup', this.handleKeyUp.bind(this));
      window.addEventListener('blur', () => {
        this.pressedKeys.clear();
        this.stopArrowRepeat();
      });
    },

    stopArrowRepeat() {
      if (this.arrowInitialTimeout) {
        clearTimeout(this.arrowInitialTimeout);
        this.arrowInitialTimeout = null;
      }
      if (this.arrowRepeatTimer) {
        clearInterval(this.arrowRepeatTimer);
        this.arrowRepeatTimer = null;
      }
      this.activeArrowKey = null;
    },

    startArrowRepeat(key) {
      this.stopArrowRepeat();
      this.activeArrowKey = key;

      // ★長押し認識までのディレイ (110ms)★
      this.arrowInitialTimeout = setTimeout(() => {
        // ★長押し時の移動速度を「もう少し早く」(75ms = 毎秒約13.3マス: キビキビ動きつつ狙いやすい絶妙な速度)★
        this.arrowRepeatTimer = setInterval(() => {
          if (this.activeArrowKey) {
            this.stepArrow(this.activeArrowKey);
          }
        }, 75);
      }, 110);
    },

    stepArrow(key) {
      if (!AppState.puzzle || AppState.isSolved) return;

      let dr = 0, dc = 0;
      if (key === 'arrowup') dr = -1;
      if (key === 'arrowdown') dr = 1;
      if (key === 'arrowleft') dc = -1;
      if (key === 'arrowright') dc = 1;
      if (dr === 0 && dc === 0) return;

      if (!AppState.focusedCell.active) {
        AppState.focusedCell.active = true;
      }

      const prevRow = AppState.focusedCell.row;
      const prevCol = AppState.focusedCell.col;
      const newRow = Math.max(0, Math.min(AppState.puzzle.height - 1, prevRow + dr));
      const newCol = Math.max(0, Math.min(AppState.puzzle.width - 1, prevCol + dc));

      const player = AppState.isHost ? 'host' : 'guest';

      // D押しながら: 塗る (1)
      // F押しながら: バツ印 (2)
      // S押しながら: 消す (0)
      if (this.pressedKeys.has('d')) {
        applyCellExplicit(prevRow, prevCol, 1, player, true);
        applyCellExplicit(newRow, newCol, 1, player, true);
      } else if (this.pressedKeys.has('f')) {
        applyCellExplicit(prevRow, prevCol, 2, player, true);
        applyCellExplicit(newRow, newCol, 2, player, true);
      } else if (this.pressedKeys.has('s')) {
        applyCellExplicit(prevRow, prevCol, 0, player, true);
        applyCellExplicit(newRow, newCol, 0, player, true);
      }

      AppState.focusedCell.row = newRow;
      AppState.focusedCell.col = newCol;

      // 相手にカーソル位置を通知
      const cs = AppState.camera.cellSize;
      const worldX = AppState.camera.hintWidth + (newCol + 0.5) * cs;
      const worldY = AppState.camera.hintHeight + (newRow + 0.5) * cs;
      sendNetworkMessage({
        type: 'CURSOR_MOVE',
        row: newRow,
        col: newCol,
        worldX: worldX,
        worldY: worldY,
        player: player
      });
    },

    handleKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      this.pressedKeys.add(key);

      if (!AppState.puzzle || AppState.isSolved) return;

      const isArrow = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key);

      if (isArrow) {
        e.preventDefault(); // 画面スクロール抑止

        // OS標準のキーリピートイベントを無視し、自前タイマーで制御
        if (e.repeat) return;

        // キーが押された瞬間に即座に1歩移動
        this.stepArrow(key);

        // 自前タイマーによる滑らかな長押しリピートを開始
        this.startArrowRepeat(key);

      } else if (!e.repeat && ['d', 'f', 's', ' '].includes(key)) {
        // 単体キー押下時: 現在のマスをその場で操作
        AppState.focusedCell.active = true;
        const r = AppState.focusedCell.row;
        const c = AppState.focusedCell.col;
        const player = AppState.isHost ? 'host' : 'guest';
        const currentCell = AppState.grid[r][c];

        if (key === 'd') {
          const next = (currentCell.state === 1) ? 0 : 1;
          applyCellExplicit(r, c, next, player, true);
        } else if (key === 'f') {
          const next = (currentCell.state === 2) ? 0 : 2;
          applyCellExplicit(r, c, next, player, true);
        } else if (key === 's') {
          applyCellExplicit(r, c, 0, player, true);
        } else if (key === ' ') {
          applyCellAction(r, c, AppState.currentTool, player, true);
        }
      }
    },

    handleKeyUp(e) {
      const key = e.key.toLowerCase();
      this.pressedKeys.delete(key);

      if (key === this.activeArrowKey) {
        this.stopArrowRepeat();

        // 他の矢印キーがまだ押されていればそちらに切り替え
        const remainingArrow = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].find(k => this.pressedKeys.has(k));
        if (remainingArrow) {
          this.stepArrow(remainingArrow);
          this.startArrowRepeat(remainingArrow);
        }
      }
    },

    screenToGrid(screenX, screenY) {
      if (!AppState.puzzle) return { isValid: false };
      const { camera } = AppState;
      const rect = DOM.canvas.getBoundingClientRect();
      const clientX = screenX - rect.left;
      const clientY = screenY - rect.top;

      const worldX = (clientX - camera.offsetX) / camera.scale;
      const worldY = (clientY - camera.offsetY) / camera.scale;

      const boardOriginX = camera.hintWidth;
      const boardOriginY = camera.hintHeight;

      const col = Math.floor((worldX - boardOriginX) / camera.cellSize);
      const row = Math.floor((worldY - boardOriginY) / camera.cellSize);

      return {
        col,
        row,
        worldX,
        worldY,
        isValid: (
          col >= 0 && col < AppState.puzzle.width &&
          row >= 0 && row < AppState.puzzle.height
        )
      };
    },

    handleMouseDown(e) {
      e.preventDefault();
      this.lastMousePos = { x: e.clientX, y: e.clientY };

      // ★クリア達成時: 画面クリックで「答えの画像 ⇄ 完成盤面」をトグル表示★
      if (AppState.isSolved) {
        toggleClearViewMode();
        return;
      }

      if (e.button === 1 || e.shiftKey || e.altKey) {
        this.isPanning = true;
        DOM.canvas.style.cursor = 'grab';
        return;
      }

      this.isPointerDown = true;
      this.dragTool = (e.button === 2) ? 'cross' : AppState.currentTool;

      const gridPos = this.screenToGrid(e.clientX, e.clientY);
      if (gridPos.isValid && !AppState.isSolved) {
        AppState.focusedCell.row = gridPos.row;
        AppState.focusedCell.col = gridPos.col;
        AppState.focusedCell.active = true;
        this.lastRow = gridPos.row;
        this.lastCol = gridPos.col;
        const currentCell = AppState.grid[gridPos.row][gridPos.col];
        if (this.dragTool === 'fill') {
          this.dragTargetValue = (currentCell.state === 1) ? 0 : 1;
        } else if (this.dragTool === 'cross') {
          this.dragTargetValue = (currentCell.state === 2) ? 0 : 2;
        } else {
          this.dragTargetValue = 0;
        }
        applyCellExplicit(gridPos.row, gridPos.col, this.dragTargetValue, AppState.isHost ? 'host' : 'guest', true);
      }
    },

    handleMouseMove(e) {
      if (this.isPanning) {
        const dx = e.clientX - this.lastMousePos.x;
        const dy = e.clientY - this.lastMousePos.y;
        AppState.camera.offsetX += dx;
        AppState.camera.offsetY += dy;
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        return;
      }

      const gridPos = this.screenToGrid(e.clientX, e.clientY);

      if (this.isPointerDown && gridPos.isValid && this.dragTargetValue !== null && !AppState.isSolved) {
        if (gridPos.row !== this.lastRow || gridPos.col !== this.lastCol) {
          this.lastRow = gridPos.row;
          this.lastCol = gridPos.col;
          applyCellExplicit(gridPos.row, gridPos.col, this.dragTargetValue, AppState.isHost ? 'host' : 'guest', true);
        }
      }

      const now = Date.now();
      if (now - this.lastSentCursorTime > 30) {
        this.lastSentCursorTime = now;
        sendNetworkMessage({
          type: 'CURSOR_MOVE',
          row: gridPos.isValid ? gridPos.row : -1,
          col: gridPos.isValid ? gridPos.col : -1,
          worldX: gridPos.worldX || 0,
          worldY: gridPos.worldY || 0,
          player: AppState.isHost ? 'host' : 'guest'
        });
      }
    },

    handleMouseUp() {
      this.isPointerDown = false;
      this.isPanning = false;
      this.dragTool = null;
      this.dragTargetValue = null;
      this.lastRow = -1;
      this.lastCol = -1;
      DOM.canvas.style.cursor = 'crosshair';
    },

    handleWheel(e) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      zoomAt(e.clientX, e.clientY, zoomFactor);
    },

    handleTouchStart(e) {
      e.preventDefault();
      const touches = e.touches;

      if (touches.length >= 2) {
        this.outsideTapCandidate = false;
      }

      // ★クリア達成時: 画面タップで「答えの画像 ⇄ 完成盤面」をトグル表示★
      if (AppState.isSolved && touches.length === 1) {
        this.outsideTapCandidate = false;
        toggleClearViewMode();
        return;
      }

      if (touches.length === 1) {
        this.isPointerDown = true;
        this.dragTool = AppState.currentTool;
        const touch = touches[0];
        const gridPos = this.screenToGrid(touch.clientX, touch.clientY);
        this.outsideTapCandidate = !gridPos.isValid;
        this.outsideTapStart = { x: touch.clientX, y: touch.clientY };
        if (gridPos.isValid && !AppState.isSolved) {
          AppState.focusedCell.row = gridPos.row;
          AppState.focusedCell.col = gridPos.col;
          AppState.focusedCell.active = true;
          this.lastRow = gridPos.row;
          this.lastCol = gridPos.col;
          const currentCell = AppState.grid[gridPos.row][gridPos.col];
          if (this.dragTool === 'fill') {
            this.dragTargetValue = (currentCell.state === 1) ? 0 : 1;
          } else if (this.dragTool === 'cross') {
            this.dragTargetValue = (currentCell.state === 2) ? 0 : 2;
          } else {
            this.dragTargetValue = 0;
          }
          applyCellExplicit(gridPos.row, gridPos.col, this.dragTargetValue, AppState.isHost ? 'host' : 'guest', true);
        }
      } else if (touches.length >= 2) {
        this.isPointerDown = false;
        this.isPanning = true;
        this.dragTargetValue = null;

        const t1 = touches[0];
        const t2 = touches[1];
        this.initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this.initialCameraScale = AppState.camera.scale;
        this.initialCameraOffset = { x: AppState.camera.offsetX, y: AppState.camera.offsetY };
        this.initialPinchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };
      }
    },

    handleTouchMove(e) {
      e.preventDefault();
      const touches = e.touches;

      if (touches.length >= 2) {
        this.outsideTapCandidate = false;
      } else if (touches.length === 1 && this.outsideTapCandidate) {
        const touch = touches[0];
        if (Math.hypot(
          touch.clientX - this.outsideTapStart.x,
          touch.clientY - this.outsideTapStart.y
        ) > 10) {
          this.outsideTapCandidate = false;
        }
      }

      if (touches.length === 1 && this.isPointerDown && !this.isPanning) {
        const touch = touches[0];
        const gridPos = this.screenToGrid(touch.clientX, touch.clientY);
        if (gridPos.isValid && this.dragTargetValue !== null && !AppState.isSolved) {
          if (gridPos.row !== this.lastRow || gridPos.col !== this.lastCol) {
            this.lastRow = gridPos.row;
            this.lastCol = gridPos.col;
            applyCellExplicit(gridPos.row, gridPos.col, this.dragTargetValue, AppState.isHost ? 'host' : 'guest', true);
          }
        }

        const now = Date.now();
        if (now - this.lastSentCursorTime > 35) {
          this.lastSentCursorTime = now;
          sendNetworkMessage({
            type: 'CURSOR_MOVE',
            row: gridPos.isValid ? gridPos.row : -1,
            col: gridPos.isValid ? gridPos.col : -1,
            worldX: gridPos.worldX || 0,
            worldY: gridPos.worldY || 0,
            player: AppState.isHost ? 'host' : 'guest'
          });
        }
      } else if (touches.length >= 2) {
        const t1 = touches[0];
        const t2 = touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };

        if (this.initialPinchDist > 0) {
          const scaleMultiplier = currentDist / this.initialPinchDist;
          const targetScale = Math.min(Math.max(this.initialCameraScale * scaleMultiplier, 0.35), 3.0);

          const rect = DOM.canvas.getBoundingClientRect();
          const cx = this.initialPinchCenter.x - rect.left;
          const cy = this.initialPinchCenter.y - rect.top;

          const worldX = (cx - this.initialCameraOffset.x) / this.initialCameraScale;
          const worldY = (cy - this.initialCameraOffset.y) / this.initialCameraScale;

          const panDx = currentCenter.x - this.initialPinchCenter.x;
          const panDy = currentCenter.y - this.initialPinchCenter.y;

          AppState.camera.scale = targetScale;
          AppState.camera.offsetX = cx - (worldX * targetScale) + panDx;
          AppState.camera.offsetY = cy - (worldY * targetScale) + panDy;
        }
      }
    },

    handleTouchEnd(e) {
      if (e.touches.length === 0) {
        if (e.type === 'touchend' && this.outsideTapCandidate && !AppState.isSolved) {
          const nextTool = AppState.currentTool === 'fill' ? 'cross' : 'fill';
          selectTool(nextTool);
          showToast(nextTool === 'fill' ? '塗りモードに切り替えました' : 'バツ印モードに切り替えました');
        }
        this.outsideTapCandidate = false;
        this.isPointerDown = false;
        this.isPanning = false;
        this.dragTool = null;
        this.dragTargetValue = null;
        this.lastRow = -1;
        this.lastCol = -1;
      } else if (e.touches.length === 1) {
        this.isPanning = false;
      }
    }
  };

  function zoomAt(clientX, clientY, factor) {
    const { camera } = AppState;
    const rect = DOM.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const newScale = Math.min(Math.max(camera.scale * factor, 0.35), 3.0);
    const worldX = (x - camera.offsetX) / camera.scale;
    const worldY = (y - camera.offsetY) / camera.scale;

    camera.scale = newScale;
    camera.offsetX = x - worldX * newScale;
    camera.offsetY = y - worldY * newScale;
  }

  function resetView() {
    const { camera, puzzle } = AppState;
    if (!puzzle) return;

    const rect = DOM.canvasContainer.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;

    // 盤面サイズに応じてセル基本サイズを動的調整 (30x30まで対応)
    if (puzzle.width >= 30) {
      camera.cellSize = 18;
    } else if (puzzle.width >= 25) {
      camera.cellSize = 21;
    } else if (puzzle.width >= 20) {
      camera.cellSize = 24;
    } else if (puzzle.width >= 15) {
      camera.cellSize = 28;
    } else if (puzzle.width <= 5) {
      camera.cellSize = 48;
    } else {
      camera.cellSize = 34;
    }

    const boardTotalW = camera.hintWidth + puzzle.width * camera.cellSize + 40;
    const boardTotalH = camera.hintHeight + puzzle.height * camera.cellSize + 40;

    const scaleX = (cw * 0.92) / boardTotalW;
    const scaleY = (ch * 0.82) / boardTotalH;
    camera.scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.28), 1.8);

    camera.offsetX = (cw - boardTotalW * camera.scale) / 2 + 10;
    camera.offsetY = (ch - boardTotalH * camera.scale) / 2 + 10;
  }

  /* ==========================================================================
     9. Canvas 描画エンジン (Retina対応 & クリア時元ベクター画像クロスフェード)
     ========================================================================== */
  const particles = [];

  function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = (Math.PI / 2) * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fill();
  }

  function spawnConfetti(originX, originY, count = 100, pattern = 'cannon') {
    const cw = DOM.canvas.width / (window.devicePixelRatio || 1);
    const ch = DOM.canvas.height / (window.devicePixelRatio || 1);
    const ox = originX !== undefined ? originX : cw / 2;
    const oy = originY !== undefined ? originY : ch * 0.45;

    const colors = [
      '#ffd700', '#ffeb3b', '#ff4757', '#2ed573', '#1e90ff',
      '#ffa502', '#ffffff', '#ff6b81', '#a55eea', '#70a1ff'
    ];
    const types = ['ribbon', 'star', 'sparkle', 'circle'];

    for (let i = 0; i < count; i++) {
      let vx, vy, gravity;
      if (pattern === 'left-cannon') {
        vx = Math.random() * 15 + 4;
        vy = -(Math.random() * 19 + 12);
        gravity = 0.36;
      } else if (pattern === 'right-cannon') {
        vx = -(Math.random() * 15 + 4);
        vy = -(Math.random() * 19 + 12);
        gravity = 0.36;
      } else if (pattern === 'burst') {
        const angle = Math.random() * Math.PI * 2;
        const spd = Math.random() * 16 + 2;
        vx = Math.cos(angle) * spd;
        vy = Math.sin(angle) * spd - 3;
        gravity = 0.28;
      } else {
        vx = (Math.random() - 0.5) * 22;
        vy = -(Math.random() * 18 + 8);
        gravity = 0.34;
      }

      particles.push({
        type: types[Math.floor(Math.random() * types.length)],
        x: ox,
        y: oy,
        vx: vx,
        vy: vy,
        gravity: gravity,
        size: Math.random() * 8 + 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        vr: (Math.random() - 0.5) * 14,
        alpha: 1,
        fadeSpeed: Math.random() * 0.005 + 0.005
      });
    }
  }

  function spawnShockwave(x, y) {
    particles.push({
      type: 'shockwave',
      x: x,
      y: y,
      radius: 10,
      growth: 16,
      lineWidth: 6,
      color: '#ffd700',
      alpha: 1,
      fadeSpeed: 0.02
    });
  }

  // ★豪華なクリア祝賀演出 (キャノン砲・星・花火の連続バースト)★
  function triggerGrandCelebration() {
    particles.length = 0;
    const cw = DOM.canvas.width / (window.devicePixelRatio || 1);
    const ch = DOM.canvas.height / (window.devicePixelRatio || 1);

    // 1. 中央からの爆発 ＋ 黄金の衝撃波リング
    spawnShockwave(cw / 2, ch * 0.45);
    spawnConfetti(cw / 2, ch * 0.45, 120, 'burst');

    // 2. 左右下部キャノン砲からの盛大な打ち上げ
    spawnConfetti(cw * 0.08, ch * 0.92, 90, 'left-cannon');
    spawnConfetti(cw * 0.92, ch * 0.92, 90, 'right-cannon');

    // 3. 0.45秒後の第二波花火
    setTimeout(() => {
      if (AppState.isSolved) {
        spawnConfetti(cw * 0.28, ch * 0.35, 60, 'burst');
        spawnConfetti(cw * 0.72, ch * 0.35, 60, 'burst');
      }
    }, 450);

    // 4. 0.95秒後の上空からのキラキラ余韻
    setTimeout(() => {
      if (AppState.isSolved) {
        spawnConfetti(cw / 2, ch * 0.12, 70, 'burst');
      }
    }, 950);
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = DOM.canvasContainer.getBoundingClientRect();
    DOM.canvas.width = rect.width * dpr;
    DOM.canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    const { camera, puzzle, grid, rowHints, colHints, remoteCursor, isSolved } = AppState;
    const cw = DOM.canvas.width / (window.devicePixelRatio || 1);
    const ch = DOM.canvas.height / (window.devicePixelRatio || 1);

    // 背景: 添付画像準拠の温かみのある砂岩（サンドストーン）調
    ctx.fillStyle = '#c4b182';
    ctx.fillRect(0, 0, cw, ch);

    // 砂岩の質感を演出する微細なグラデーション
    const bgGrad = ctx.createLinearGradient(0, 0, cw, ch);
    bgGrad.addColorStop(0, 'rgba(255, 248, 225, 0.35)');
    bgGrad.addColorStop(0.5, 'rgba(196, 177, 130, 0)');
    bgGrad.addColorStop(1, 'rgba(145, 122, 70, 0.30)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cw, ch);

    if (!puzzle) {
      requestAnimationFrame(render);
      return;
    }

    ctx.save();
    ctx.translate(camera.offsetX, camera.offsetY);
    ctx.scale(camera.scale, camera.scale);

    const bX = camera.hintWidth;
    const bY = camera.hintHeight;
    const cs = camera.cellSize;
    const totalW = puzzle.width * cs;
    const totalH = puzzle.height * cs;

    // クリア演出アニメーション進行度 (約3秒かけて徐々に切り替え)
    let clearProgress = 0;
    let imageAlpha = 0;
    let hintFade = 0;
    if (isSolved) {
      const elapsed = performance.now() - AppState.clearAnim.startTime;
      clearProgress = Math.min(1, elapsed / AppState.clearAnim.duration);

      hintFade = Math.min(1, clearProgress * 1.5);

      // 元画像表示モード時: 約3秒かけて滑らかに元画像がフェードイン (余韻のあと徐々にクロスフェード)
      if (AppState.viewModeInClear === 'image') {
        if (clearProgress > 0.15) {
          const p = (clearProgress - 0.15) / 0.85;
          imageAlpha = 0.5 - 0.5 * Math.cos(p * Math.PI); // Smooth In-Out
        }
        // ★画像が表示されきった後 (clearProgress >= 0.98) に答えのタイトルを華やかに開示！
        if (clearProgress >= 0.98 && !AppState.titleRevealed && AppState.puzzle) {
          revealPuzzleTitle();
        }
      } else {
        imageAlpha = 0; // 盤面表示モード
      }
    }

    // 1. ヒント背景エリア (添付画像のようなオリーブサンド/カーキ調の交互ストライプ)
    const hintAlpha = Math.max(0, 1 - hintFade * 0.85);
    ctx.save();
    ctx.globalAlpha = hintAlpha;

    // 行ヒント背景ストライプ (左側)
    for (let r = 0; r < puzzle.height; r++) {
      ctx.fillStyle = (r % 2 === 0) ? '#b4a374' : '#a89768';
      ctx.fillRect(0, bY + r * cs, camera.hintWidth, cs);
    }
    // 列ヒント背景ストライプ (上側)
    for (let c = 0; c < puzzle.width; c++) {
      ctx.fillStyle = (c % 2 === 0) ? '#b4a374' : '#a89768';
      ctx.fillRect(bX + c * cs, 0, cs, camera.hintHeight);
    }
    // 左上コーナー
    ctx.fillStyle = '#9e8d60';
    ctx.fillRect(0, 0, camera.hintWidth, camera.hintHeight);

    // 2. 行ヒント文字 (添付画像のようなクッキリとした濃いこげ茶〜黒で抜群の視認性)
    const hintFontSize = Math.max(10, Math.min(13, cs * 0.45));
    ctx.font = `700 ${hintFontSize}px -apple-system, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1c140a';

    for (let r = 0; r < puzzle.height; r++) {
      const hints = rowHints[r] || [0];
      const cy = bY + r * cs + cs / 2;
      for (let i = 0; i < hints.length; i++) {
        const val = hints[hints.length - 1 - i];
        const hx = bX - 8 - i * (hintFontSize + 6);
        ctx.fillText(val.toString(), hx, cy);
      }
    }

    // 3. 列ヒント文字 (縦向き・上側)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let c = 0; c < puzzle.width; c++) {
      const hints = colHints[c] || [0];
      const cx = bX + c * cs + cs / 2;
      for (let i = 0; i < hints.length; i++) {
        const val = hints[hints.length - 1 - i];
        const hy = bY - 6 - i * (hintFontSize + 6);
        ctx.fillText(val.toString(), cx, hy);
      }
    }
    ctx.restore();

    // 4. 盤面背景: 明るいサンドベージュ
    ctx.fillStyle = '#ded1aa';
    ctx.fillRect(bX, bY, totalW, totalH);

    // 5. セル描画
    for (let r = 0; r < puzzle.height; r++) {
      for (let c = 0; c < puzzle.width; c++) {
        const cell = grid[r][c];
        const x = bX + c * cs;
        const y = bY + r * cs;

        // 空セル (未彫削): 砂岩タイルの微細な明暗交互で石の立体感を表現
        ctx.fillStyle = ((r + c) % 2 === 0) ? '#ded1aa' : '#d4c69e';
        ctx.fillRect(x, y, cs, cs);

        if (cell.state === 1) {
          // 塗りセル: 少し明るめの落ち着いた濃い茶色（ダークウォールナット/チョコレート）
          // ホスト=濃い茶色(#4a3625)、ゲスト=赤みを帯びた濃い茶色(#583a28)
          ctx.fillStyle = (cell.by === 'guest') ? '#583a28' : '#4a3625';
          if (isSolved && AppState.viewModeInClear === 'board') {
            ctx.fillRect(x, y, cs, cs);
          } else {
            // シャープな彫り込み表現
            ctx.fillRect(x + 1.2, y + 1.2, cs - 2.4, cs - 2.4);
          }
        } else if (cell.state === 2 && !isSolved) {
          // ✕マーク: 視認性の良いクラシックレッド
          ctx.strokeStyle = '#c23224';
          ctx.lineWidth = Math.max(1.8, cs * 0.08);
          ctx.beginPath();
          const pad = cs * 0.22;
          ctx.moveTo(x + pad, y + pad);
          ctx.lineTo(x + cs - pad, y + cs - pad);
          ctx.moveTo(x + cs - pad, y + pad);
          ctx.lineTo(x + pad, y + cs - pad);
          ctx.stroke();
        }
      }
    }

    // 6. グリッド線描画 (クリア時は薄くフェード)
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - hintFade * 0.9);

    // 1マスごとの細線: 砂岩になじむ落ち着いた薄いブラウン
    ctx.strokeStyle = 'rgba(80, 60, 35, 0.25)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let r = 0; r <= puzzle.height; r++) {
      ctx.moveTo(bX, bY + r * cs);
      ctx.lineTo(bX + totalW, bY + r * cs);
    }
    for (let c = 0; c <= puzzle.width; c++) {
      ctx.moveTo(bX + c * cs, bY);
      ctx.lineTo(bX + c * cs, bY + totalH);
    }
    ctx.stroke();

    // ★5マスごとの区切り線: 緑ではなく、目立たないがしっかり判別できる深みのある落ち着いたブラウン★
    ctx.strokeStyle = 'rgba(60, 42, 20, 0.58)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let r = 0; r <= puzzle.height; r += 5) {
      ctx.moveTo(bX, bY + r * cs);
      ctx.lineTo(bX + totalW, bY + r * cs);
    }
    for (let c = 0; c <= puzzle.width; c += 5) {
      ctx.moveTo(bX + c * cs, bY);
      ctx.lineTo(bX + c * cs, bY + totalH);
    }
    ctx.stroke();
    ctx.restore();

    // 盤面外枠: 砂岩/ブロンズの額縁 (クリア時は黄金)
    ctx.strokeStyle = isSolved ? '#dca828' : '#765c34';
    ctx.lineWidth = 3;
    ctx.shadowColor = isSolved ? 'rgba(220, 168, 40, 0.6)' : 'rgba(0,0,0,0)';
    ctx.shadowBlur = isSolved ? 10 : 0;
    ctx.strokeRect(bX, bY, totalW, totalH);
    ctx.shadowBlur = 0;

    // 7. ★クリア時: 元となった高解像度ベクターアートの徐々に切り替わるクロスフェード表示★
    if (isSolved && imageAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = imageAlpha;

      // クリア時の元画像の背景: 白い石板表面
      ctx.fillStyle = '#f8f6f0';
      ctx.shadowColor = 'rgba(232, 192, 80, 0.5)';
      ctx.shadowBlur = 24 * imageAlpha;
      ctx.fillRect(bX, bY, totalW, totalH);

      // Path2Dによる高精細ベクター描画 (ジャギーゼロ・パズルのマスと完全に一致するズーム＆配置で即時描画)
      if (puzzle.path2d) {
        ctx.save();
        ctx.translate(bX, bY);
        if (puzzle.transform) {
          ctx.translate(totalW / 2, totalH / 2);
          ctx.scale(puzzle.transform.fitScale * cs, puzzle.transform.fitScale * cs);
          ctx.translate(-puzzle.transform.cx, -puzzle.transform.cy);
        } else {
          ctx.scale(totalW / 512, totalH / 512);
        }
        ctx.fillStyle = '#38281b';
        ctx.fill(puzzle.path2d);
        ctx.restore();
      }
      ctx.restore();
    }

    // 7.5. 自分自身のキーボード操作フォーカス枠
    if (!isSolved && AppState.focusedCell.active && AppState.focusedCell.row >= 0 && AppState.focusedCell.col >= 0) {
      const fx = bX + AppState.focusedCell.col * cs;
      const fy = bY + AppState.focusedCell.row * cs;
      ctx.save();
      ctx.strokeStyle = '#e8c050'; // ゴールドのフォーカス枠
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(232, 192, 80, 0.7)';
      ctx.shadowBlur = 8;
      ctx.strokeRect(fx + 1, fy + 1, cs - 2, cs - 2);
      ctx.restore();
    }

    // 8. ★相手プレイヤーが選択中のセル枠描画 (カーソル本体やHost/Guest文字は非表示にし、選択中セルのみ表示)★
    if (!isSolved && remoteCursor.active && Date.now() - remoteCursor.lastUpdate < 8000) {
      if (remoteCursor.row >= 0 && remoteCursor.col >= 0 && puzzle && remoteCursor.row < puzzle.height && remoteCursor.col < puzzle.width) {
        const isRemoteHost = !AppState.isHost;
        const borderColor = isRemoteHost ? '#4d88ff' : '#ff4d4d';
        const fillColor = isRemoteHost ? 'rgba(77, 136, 255, 0.22)' : 'rgba(255, 77, 77, 0.22)';
        const invScale = 1 / camera.scale;
        const hx = bX + remoteCursor.col * cs;
        const hy = bY + remoteCursor.row * cs;

        ctx.save();
        // 相手が選択中のセルをうっすらハイライト
        ctx.fillStyle = fillColor;
        ctx.fillRect(hx + 1, hy + 1, cs - 2, cs - 2);

        // 明確でスタイリッシュな選択枠
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2.5 * invScale;
        ctx.strokeRect(hx + 1, hy + 1, cs - 2, cs - 2);
        ctx.restore();
      }
    }

    ctx.restore();

    // 9. ★クリア時の祝賀花火・紙吹雪・星・スパークル & STAGE CLEARバナー描画★
    if (particles.length > 0) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        if (p.type === 'shockwave') {
          p.radius += p.growth;
          p.growth *= 0.97;
          p.lineWidth = Math.max(1, p.lineWidth * 0.97);
          p.alpha -= p.fadeSpeed;
          if (p.alpha <= 0) {
            particles.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.lineWidth;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.shadowColor = '#ffd700';
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.restore();
          continue;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity || 0.34;
        p.vx *= 0.985;
        p.rotation += p.vr;
        p.alpha -= p.fadeSpeed || 0.008;

        if (p.alpha <= 0 || p.y > ch + 40) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.alpha);

        if (p.type === 'ribbon') {
          const scaleX = Math.cos(p.rotation * 0.04);
          ctx.fillRect(-p.size * scaleX, -p.size * 0.4, p.size * 2 * scaleX, p.size * 0.8);
        } else if (p.type === 'star') {
          drawStar(ctx, 0, 0, 5, p.size, p.size * 0.45);
        } else if (p.type === 'sparkle') {
          const s = p.size;
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.quadraticCurveTo(0, 0, s, 0);
          ctx.quadraticCurveTo(0, 0, 0, s);
          ctx.quadraticCurveTo(0, 0, -s, 0);
          ctx.quadraticCurveTo(0, 0, 0, -s);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    requestAnimationFrame(render);
  }

  /* ==========================================================================
     10. UI インタラクション & バインディング
     ========================================================================== */
  function setRoleUI(isHost) {
    if (isHost) {
      DOM.roleBadge.textContent = 'HOST (PC)';
      DOM.roleBadge.className = 'badge badge-host';
    } else {
      DOM.roleBadge.textContent = 'GUEST (iPad)';
      DOM.roleBadge.className = 'badge badge-guest';
    }
  }

  function updateUIStatus(state, text) {
    DOM.statusText.textContent = text;
    DOM.statusDot.className = 'status-dot ' + (state === 'online' ? 'online' : 'waiting');
  }

  let toastTimer = null;
  function showToast(msg, persistent = false, isClear = false) {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    DOM.actionToast.textContent = msg;
    if (isClear) {
      DOM.actionToast.classList.add('clear-popup');
    } else {
      DOM.actionToast.classList.remove('clear-popup');
    }
    DOM.actionToast.classList.add('show');

    if (!persistent) {
      toastTimer = setTimeout(() => {
        DOM.actionToast.classList.remove('show');
        DOM.actionToast.classList.remove('clear-popup');
        toastTimer = null;
      }, 2800);
    }
  }

  function selectTool(tool) {
    AppState.currentTool = tool;
    DOM.toolFill.classList.toggle('active', tool === 'fill');
    DOM.toolCross.classList.toggle('active', tool === 'cross');
    DOM.toolClear.classList.toggle('active', tool === 'clear');
  }

  function setupUIEvents() {
    // ツールバー
    DOM.toolFill.addEventListener('click', () => selectTool('fill'));
    DOM.toolCross.addEventListener('click', () => selectTool('cross'));
    DOM.toolClear.addEventListener('click', () => selectTool('clear'));
    DOM.btnResetView.addEventListener('click', resetView);

    // 盤面サイズ変更 (ヘッダーのセレクトボックス)
    DOM.selectBoardSize.addEventListener('change', (e) => {
      const newSize = parseInt(e.target.value);
      if (AppState.isHost || !AppState.isConnected) {
        startNewRandomPuzzle(newSize);
      } else {
        sendNetworkMessage({
          type: 'REQUEST_SIZE_CHANGE',
          size: newSize
        });
        showToast(`ホストへサイズ ${newSize}×${newSize} への変更をリクエストしました`);
      }
    });

    // 招待URLコピー
    DOM.btnShare.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast('招待URLをクリップボードにコピーしました！');
        }).catch(() => {
          prompt('以下のURLを相手に共有してください:', url);
        });
      } else {
        prompt('以下のURLを相手に共有してください:', url);
      }
    });

    // 部屋作成ボタン (ハッシュ未指定時)
    DOM.btnCreateRoom.addEventListener('click', () => {
      const newRoom = generateRoomId();
      window.location.hash = newRoom;
      location.reload();
    });

    // ランダム新問題出題ボタン (ヘッダー)
    DOM.btnChangePuzzle.addEventListener('click', () => {
      if (AppState.isHost || !AppState.isConnected) {
        startNewRandomPuzzle(AppState.currentSize);
      } else {
        sendNetworkMessage({ type: 'REQUEST_NEXT_PUZZLE' });
        showToast('ホストへ新しい問題をリクエストしました');
      }
    });

    // クリアバナーの「次の問題へ 🎲」ボタン
    DOM.btnBannerNext.addEventListener('click', () => {
      if (AppState.isHost || !AppState.isConnected) {
        startNewRandomPuzzle(AppState.currentSize);
      } else {
        sendNetworkMessage({ type: 'REQUEST_NEXT_PUZZLE' });
        showToast('ホストへ新しい問題をリクエストしました');
      }
    });

    // クリア後の「盤面 ⇄ 元画像」切り替えボタン (画面下部クリアバナー内)
    if (DOM.btnToggleView) {
      DOM.btnToggleView.addEventListener('click', toggleClearViewMode);
    }

    // サウンド切替ボタン (効果音)
    if (DOM.btnToggleSound) {
      DOM.btnToggleSound.addEventListener('click', () => {
        SoundManager.toggleMute();
      });
    }

    // BGM切替ボタン (ヘッダー)
    if (DOM.btnToggleBgm) {
      DOM.btnToggleBgm.addEventListener('click', () => {
        SoundManager.toggleBgm();
      });
    }

    // BGM音量スライダー (ヘッダー: 0~100%)
    if (DOM.bgmVolume) {
      DOM.bgmVolume.addEventListener('input', (e) => {
        SoundManager.setBgmSliderPercent(parseInt(e.target.value, 10));
      });
    }

    // セーブデータ管理モーダルの開閉
    if (DOM.btnOpenSaveModal) {
      DOM.btnOpenSaveModal.addEventListener('click', () => SaveDataManager.openModal());
    }
    if (DOM.coopClearCounter) {
      DOM.coopClearCounter.addEventListener('click', () => SaveDataManager.openModal());
    }
    if (DOM.btnCloseSaveModal) {
      DOM.btnCloseSaveModal.addEventListener('click', () => SaveDataManager.closeModal());
    }
    if (DOM.saveModal) {
      DOM.saveModal.addEventListener('click', (e) => {
        if (e.target === DOM.saveModal) SaveDataManager.closeModal();
      });
    }

    // JSONバックアップ保存 (エクスポート)
    if (DOM.btnExportJson) {
      DOM.btnExportJson.addEventListener('click', () => SaveDataManager.exportJson());
    }

    // JSONバックアップ復元 (インポート)
    if (DOM.btnImportJsonTrigger && DOM.inputSaveFile) {
      DOM.btnImportJsonTrigger.addEventListener('click', () => {
        DOM.inputSaveFile.click();
      });
      DOM.inputSaveFile.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          SaveDataManager.importJson(e.target.files[0]);
          e.target.value = ''; // 次回同じファイルを選んでも発火するようにクリア
        }
      });
    }

    // ウィンドウリサイズ
    window.addEventListener('resize', () => {
      resizeCanvas();
    });
  }

  /* ==========================================================================
     11. アプリケーション起動
     ========================================================================== */
  function main() {
    SoundManager.init();
    CoopStatsManager.init();
    setupUIEvents();
    InputManager.init();
    resizeCanvas();
    startNewRandomPuzzle(15);
    initNetwork();
    requestAnimationFrame(render);
  }

  function isMobileOrTablet() {
    const userAgent = navigator.userAgent || '';
    const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent) || isIPadOS;
  }

  function startAfterOptionalIconLoad() {
    // 大容量の全アイコンデータはPCだけで読み込む。モバイルは組み込みの問題で起動する。
    if (isMobileOrTablet()) {
      main();
      return;
    }

    const iconDataScript = document.createElement('script');
    iconDataScript.src = 'assets/icons_data.js?v=ja1';
    iconDataScript.onload = main;
    iconDataScript.onerror = () => {
      console.warn('Icon data could not be loaded; starting with fallback puzzles.');
      main();
    };
    document.head.appendChild(iconDataScript);
  }

  window.addEventListener('DOMContentLoaded', startAfterOptionalIconLoad);
})();
