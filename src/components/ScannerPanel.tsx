import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Aperture,
  Camera,
  CameraOff,
  Check,
  Crop,
  ImagePlus,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  AnswerKey,
  AppSettings,
  Contest,
  MCQChoice,
  Point2D,
  Student,
  StudentPaper,
} from '../types';
import { t } from '../i18n';
import {
  adaptiveThresholdImage,
  CornerQuad,
  detectFiducialCorners,
   ScanResult,
  scanSheetFromImageData,
} from '../omr/omrEngine';
import { renderSheetToCanvas } from '../sheets/sheetLayouts';
import { computePaperGrade, resolveStudentFromRoster } from '../omr/grading';
import { savePaperImage, uid } from '../storage/db';

interface Props {
  contest: Contest;
  keys: AnswerKey[];
  students: Student[];
  existingPapers: StudentPaper[];
  settings: AppSettings;
  onSavePaper: (paper: StudentPaper) => void;
}

export const ScannerPanel: React.FC<Props> = ({
  contest,
  keys,
  students,
  existingPapers,
  settings,
  onSavePaper,
}) => {
  const lang = settings.language;
  const tr = t(lang);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef<boolean>(true);
  const stableFramesRef = useRef<number>(0);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [needsManualPlayTap, setNeedsManualPlayTap] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string>('');
  const [lockedCorners, setLockedCorners] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedSbd, setSelectedSbd] = useState<string>('');
  const [selectedExamCode, setSelectedExamCode] = useState<string>('');
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [manualCropMode, setManualCropMode] = useState(false);
  const [cropQuad, setCropQuad] = useState<CornerQuad | null>(null);
  const [savedNotice, setSavedNotice] = useState<string>('');

  const sortedKeys = useMemo(
    () =>
      [...keys].sort((a, b) =>
        a.examCode.localeCompare(b.examCode, undefined, { numeric: true })
      ),
    [keys]
  );

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
    setNeedsManualPlayTap(false);
    setLockedCorners(false);
    stableFramesRef.current = 0;
  };

  useEffect(() => {
    mountedRef.current = true;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && streamRef.current) {
        const dead = streamRef.current
          .getVideoTracks()
          .every((tr) => tr.readyState === 'ended');
        if (dead) {
          stopCamera();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      stopCamera();
    };
  }, []);

  const requestCameraStreamWithFallback = async (
    desiredFacing: 'environment' | 'user'
  ): Promise<MediaStream> => {
    const attempts: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { ideal: desiredFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
      {
        audio: false,
        video: {
          facingMode: desiredFacing,
        },
      },
      {
        audio: false,
        video: true,
      },
    ];

    let lastErr: any = null;
    for (const constraints of attempts) {
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          return await navigator.mediaDevices.getUserMedia(constraints);
        }
        const legacyGetUserMedia =
          (navigator as any).webkitGetUserMedia || (navigator as any).mozGetUserMedia;
        if (legacyGetUserMedia) {
          return await new Promise<MediaStream>((resolve, reject) =>
            legacyGetUserMedia.call(navigator, constraints, resolve, reject)
          );
        }
        throw new Error('MEDIA_DEVICES_UNAVAILABLE');
      } catch (err: any) {
        lastErr = err;
        const name = err?.name || '';
        // Do not re-prompt if user or browser explicitly denied permission
        if (
          name === 'NotAllowedError' ||
          name === 'PermissionDeniedError' ||
          name === 'SecurityError'
        ) {
          throw err;
        }
      }
    }
    throw lastErr || new Error('Camera unavailable');
  };

  const formatCameraErrorMessage = (err: any): string => {
    const name = err?.name || '';
    const ua = navigator.userAgent || '';
    const isInAppWebView = /FBAN|FBAV|Messenger|Zalo|Instagram|Line|TikTok/i.test(ua);

    if (isInAppWebView) {
      return lang === 'vi'
        ? 'Trình duyệt trong ứng dụng (Zalo / Messenger / Facebook) đang chặn Camera trực tiếp. Hãy nhấn mở bằng trình duyệt Safari/Chrome, HOẶC bấm nút "Chụp bằng Camera Gốc (Nét cao)" ngay bên dưới!'
        : 'In-app browser (Messenger / Zalo / Facebook) blocks live WebRTC camera. Open this link in Safari/Chrome, OR tap "Snap with Native Camera (HD)" right below!';
    }

    if (
      name === 'NotAllowedError' ||
      name === 'PermissionDeniedError' ||
      name === 'SecurityError'
    ) {
      return lang === 'vi'
        ? 'Quyền truy cập Camera đang bị chặn. Trên iPhone: bấm biểu tượng "aA" (hoặc biểu tượng trang web) trên thanh địa chỉ Safari → Cài đặt trang web → Camera → Cho phép (hoặc vào Cài đặt iPhone → Safari → Camera → Cho phép). Bạn cũng có thể bấm "Chụp bằng Camera Gốc" bên dưới để chụp ngay!'
        : 'Camera permission was denied. On iPhone Safari: tap "aA" (or the page settings icon) in the address bar → Website Settings → Camera → Allow (or iPhone Settings → Safari → Camera → Allow). You can also tap "Snap with Native Camera (HD)" below right away!';
    }

    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return lang === 'vi'
        ? 'Không tìm thấy thiết bị Camera trên máy này. Hãy dùng nút "Chọn ảnh có sẵn trong máy" bên dưới.'
        : 'No camera device found on this device. Please use "Choose Photo from Library" below.';
    }

    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return lang === 'vi'
        ? 'Camera đang bận bởi ứng dụng khác. Hãy đóng các tab/ứng dụng đang dùng camera rồi thử lại, hoặc bấm "Chụp bằng Camera Gốc".'
        : 'Camera is currently in use by another app/tab. Close other camera apps and retry, or tap "Snap with Native Camera (HD)".';
    }

    if (!window.isSecureContext) {
      return lang === 'vi'
        ? 'Trình duyệt yêu cầu kết nối HTTPS an toàn để mở camera trực tiếp. Hãy mở link https:// hoặc dùng nút "Chụp bằng Camera Gốc" bên dưới!'
        : 'Live camera requires HTTPS. Please open via https:// or tap "Snap with Native Camera (HD)" below!';
    }

    return (
      (lang === 'vi'
        ? 'Không thể khởi động camera trực tiếp: '
        : 'Could not start live camera: ') + (err?.message || name || 'Unknown error')
    );
  };

  const startCamera = async (overrideFacing?: 'environment' | 'user') => {
    const desiredFacing = overrideFacing || facingMode;
    setCameraError('');
    setScanResult(null);

    if (
      !navigator.mediaDevices?.getUserMedia &&
      !(navigator as any).webkitGetUserMedia
    ) {
      setCameraError(formatCameraErrorMessage(new Error('MEDIA_DEVICES_UNAVAILABLE')));
      return;
    }

    // Stop any previous stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }

    // Prime the already-mounted <video> element synchronously inside the user tap gesture
    // AND make the container visible immediately so iOS WebKit never sees a 0x0 hidden video.
    const vid = videoRef.current;
    if (vid) {
      vid.muted = true;
      vid.defaultMuted = true;
      vid.playsInline = true;
      vid.autoplay = true;
      vid.setAttribute('playsinline', 'true');
      vid.setAttribute('webkit-playsinline', 'true');
      vid.setAttribute('muted', 'true');
      vid.setAttribute('autoplay', 'true');
    }

    setFacingMode(desiredFacing);
    setCameraActive(true);
    setCameraStarting(true);
    setNeedsManualPlayTap(false);

    try {
      const stream = await requestCameraStreamWithFallback(desiredFacing);
      if (!mountedRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }

      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (mountedRef.current) stopCamera();
        };
      });

      streamRef.current = stream;
      const videoEl = videoRef.current;
      if (!videoEl) {
        stopCamera();
        return;
      }

      videoEl.srcObject = stream;

      // Wait briefly for metadata if needed, then start playback
      if (videoEl.readyState < 1) {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            videoEl.removeEventListener('loadedmetadata', finish);
            resolve();
          };
          videoEl.addEventListener('loadedmetadata', finish);
          window.setTimeout(finish, 1200);
        });
      }

      try {
        await videoEl.play();
        setCameraStarting(false);
        setNeedsManualPlayTap(false);
      } catch {
        // Strict WebView blocked post-permission play(); offer a 1-tap synchronous play button
        setCameraStarting(false);
        setNeedsManualPlayTap(true);
      }
    } catch (err: any) {
      stopCamera();
      setCameraError(formatCameraErrorMessage(err));
    }
  };

  const handleFlipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    startCamera(next);
  };

  const handleManualPlayTap = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = true;
    vid
      .play()
      .then(() => {
        setNeedsManualPlayTap(false);
        setCameraStarting(false);
      })
      .catch((err) => {
        setCameraError(formatCameraErrorMessage(err));
      });
  };

  // Real-time viewfinder corner detection loop
  useEffect(() => {
    if (!cameraActive) return;
    let active = true;
    const workCanvas = document.createElement('canvas');

    const interval = window.setInterval(() => {
      if (!active || !videoRef.current || scanResult) return;
      const vid = videoRef.current;
      if (vid.videoWidth < 100 || vid.videoHeight < 100) return;

      // Fast preview pass for corner lock
      const scale = Math.min(1, 560 / vid.videoWidth);
      const pw = Math.round(vid.videoWidth * scale);
      const ph = Math.round(vid.videoHeight * scale);
      workCanvas.width = pw;
      workCanvas.height = ph;
      const wctx = workCanvas.getContext('2d')!;
      wctx.drawImage(vid, 0, 0, pw, ph);
      const imgData = wctx.getImageData(0, 0, pw, ph);
      const { binary, gray } = adaptiveThresholdImage(imgData.data, pw, ph, 0.80, 32);
      const quad = detectFiducialCorners(binary, pw, ph, gray);

      // Draw viewfinder overlay
      if (overlayCanvasRef.current) {
        const oc = overlayCanvasRef.current;
        oc.width = pw;
        oc.height = ph;
        const octx = oc.getContext('2d')!;
        octx.clearRect(0, 0, pw, ph);
        if (quad) {
          octx.strokeStyle = '#10b981';
          octx.lineWidth = 3;
          octx.beginPath();
          octx.moveTo(quad.tl.x, quad.tl.y);
          octx.lineTo(quad.tr.x, quad.tr.y);
          octx.lineTo(quad.br.x, quad.br.y);
          octx.lineTo(quad.bl.x, quad.bl.y);
          octx.closePath();
          octx.stroke();
          for (const pt of [quad.tl, quad.tr, quad.br, quad.bl]) {
            octx.fillStyle = '#10b981';
            octx.fillRect(pt.x - 6, pt.y - 6, 12, 12);
          }
        }
      }

      if (quad) {
        setLockedCorners(true);
        stableFramesRef.current += 1;
        const neededFrames =
          settings.autoCaptureDelayMs === 0
            ? 999999
            : Math.max(2, Math.round(settings.autoCaptureDelayMs / 250));
        if (stableFramesRef.current >= neededFrames) {
          stableFramesRef.current = 0;
          captureCurrentVideoFrame();
        }
      } else {
        setLockedCorners(false);
        stableFramesRef.current = 0;
      }
    }, 240);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [cameraActive, scanResult, settings.autoCaptureDelayMs]);

  const captureCurrentVideoFrame = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth < 100) return;
    const cap = document.createElement('canvas');
    cap.width = vid.videoWidth;
    cap.height = vid.videoHeight;
    cap.getContext('2d')!.drawImage(vid, 0, 0);
    processSourceCanvas(cap);
    stopCamera();
  };

  const processSourceCanvas = (canvas: HTMLCanvasElement, customQuad?: CornerQuad) => {
    setSourceCanvas(canvas);
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const res = scanSheetFromImageData(imgData, contest, sortedKeys, settings, customQuad);
    setScanResult(res);
    setSelectedSbd(res.sbd);
    // Only fall back to keys[0] when the contest truly has just 1 Mã đề
    setSelectedExamCode(
      res.examCode || (sortedKeys.length === 1 ? sortedKeys[0].examCode : '')
    );
    setCropQuad(res.corners);
    setManualCropMode(false);

    if (settings.vibrateOnScan && navigator.vibrate) {
      navigator.vibrate(65);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCameraError('');
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 2000;
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * ratio);
      c.height = Math.round(img.height * ratio);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      processSourceCanvas(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setCameraError(
        lang === 'vi'
          ? 'Không đọc được định dạng ảnh này. Trên iPhone hãy chọn định dạng JPEG/PNG hoặc chụp trực tiếp.'
          : 'Could not decode this image format. Please use JPEG/PNG or snap directly with Camera.'
      );
    };
    img.src = objectUrl;
  };

  const handleGenerateAndScanSample = () => {
    const refKey =
      sortedKeys.length > 0
        ? sortedKeys[existingPapers.length % sortedKeys.length]
        : undefined;
    const rawCode = refKey?.examCode || (contest.examCodeDigits === 4 ? '1001' : '101');
    const code = rawCode.padStart(contest.examCodeDigits, '0').slice(-contest.examCodeDigits);
    const nextIdx = (existingPapers.length + 1) % 99;
    const demoSbd = String(10000 + nextIdx).padStart(contest.sbdDigits, '0');

    const mcqLen = contest.formId === 'bgd_2025' ? contest.part1Questions : contest.totalQuestions;
    const opts: MCQChoice[] =
      contest.choiceCount === 5 && contest.formId !== 'bgd_2025'
        ? ['A', 'B', 'C', 'D', 'E']
        : ['A', 'B', 'C', 'D'];

    // Match ~85% of the key so user sees both green correct rings and red/blue correction rings!
    const sampleMcq: MCQChoice[] = Array.from({ length: mcqLen }, (_, i) => {
      const kAns = refKey?.mcqAnswers[i] || opts[i % opts.length];
      if (i % 7 === 2) {
        return opts[(opts.indexOf(kAns) + 1) % opts.length];
      }
      return kAns;
    });

    const sampleTf =
      contest.formId === 'bgd_2025'
        ? Array.from({ length: contest.part2Questions }, (_, i) => {
            const base = refKey?.tfAnswers[i] || { a: 'T', b: 'F', c: 'T', d: 'F' };
            return i === 1 ? { ...base, d: base.d === 'T' ? ('F' as const) : ('T' as const) } : { ...base };
          })
        : [];

    const sampleShort =
      contest.formId === 'bgd_2025'
        ? Array.from({ length: contest.part3Questions }, (_, i) => {
            const base = refKey?.shortAnswers[i] || String((i + 1) * 5);
            return i === contest.part3Questions - 1 ? '99' : base;
          })
        : [];

    const sampleCanvas = renderSheetToCanvas(contest, 1.35, {
      sbd: demoSbd,
      examCode: code,
      mcqAnswers: sampleMcq,
      tfAnswers: sampleTf,
      shortAnswers: sampleShort,
      perspectiveTilt: true,
    });

    processSourceCanvas(sampleCanvas);
  };

  const activeGrade = useMemo(() => {
    if (!scanResult) return null;
    return computePaperGrade(
      contest,
      sortedKeys,
      selectedSbd,
      selectedExamCode,
      scanResult.mcqAnswers,
      scanResult.tfAnswers,
      scanResult.shortAnswers,
      0,
      existingPapers
    );
  }, [contest, sortedKeys, selectedSbd, selectedExamCode, scanResult, existingPapers]);

  const handleConfirmSave = async () => {
    if (!scanResult || !activeGrade) return;
    const finalSbd = selectedSbd.trim() || '000000';
    const finalCode = selectedExamCode.trim();
    const rosterMatch = resolveStudentFromRoster(finalSbd, students, contest.classId);
    const paperId = uid('pap');

    if (scanResult.annotatedDataUrl) {
      await savePaperImage(paperId, scanResult.annotatedDataUrl);
    }

    const paper: StudentPaper = {
      id: paperId,
      contestId: contest.id,
      scannedAt: new Date().toISOString(),
      sbd: finalSbd,
      examCode: finalCode,
      studentId: rosterMatch.studentId,
      studentName: rosterMatch.studentName,
      roomName: rosterMatch.roomName,
      mcqAnswers: scanResult.mcqAnswers,
      tfAnswers: scanResult.tfAnswers,
      shortAnswers: scanResult.shortAnswers,
      part4EssayScore: 0,
      ...activeGrade,
      annotatedImageDataUrl: scanResult.annotatedDataUrl,
    };

    onSavePaper(paper);
    setSavedNotice(
      lang === 'vi'
        ? `Đã lưu bài SBD ${paper.sbd}${paper.examCode ? ` (MĐ ${paper.examCode})` : ''} — ${paper.totalScore}/${paper.maxPossibleScore} điểm!`
        : `Saved ID ${paper.sbd}${paper.examCode ? ` (Code ${paper.examCode})` : ''} — ${paper.totalScore}/${paper.maxPossibleScore} pts!`
    );
    setScanResult(null);
    setTimeout(() => setSavedNotice(''), 3500);
  };

  return (
    <div className="scanner-panel">
      {keys.length === 0 && (
        <div className="info-callout warn">
          {lang === 'vi'
            ? 'Lưu ý: Bài thi chưa có Mã đề đáp án. Hãy sang tab "Đáp án" thêm mã đề trước để tự động tính điểm.'
            : 'Tip: Add at least one Answer Key in the "Keys" tab first so scans are scored automatically.'}
        </div>
      )}

      {savedNotice && <div className="toast-success">{savedNotice}</div>}
      {cameraError && (
        <div className="info-callout warn" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>{cameraError}</span>
          <button
            type="button"
            className="primary-btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => nativeCameraInputRef.current?.click()}
          >
            <Aperture size={17} /> {tr.scan.snapNativeCamera}
          </button>
        </div>
      )}

      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      {!scanResult && (
        <div className="scanner-actions-card">
          {/* Keep <video> always mounted in DOM so iOS Safari/WebKit user-gesture priming never races React mount */}
          <div
            className="live-camera-box"
            style={{ display: cameraActive ? 'block' : 'none' }}
          >
            <div className="live-video-stage">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onPlaying={() => {
                  setCameraStarting(false);
                  setNeedsManualPlayTap(false);
                }}
                className="live-video"
              />
              <canvas ref={overlayCanvasRef} className="live-overlay-canvas" />

              {cameraStarting && !needsManualPlayTap && (
                <div className="camera-status-overlay">
                  <span>
                    {lang === 'vi'
                      ? 'Đang khởi động ống kính Camera...'
                      : 'Starting camera lens...'}
                  </span>
                </div>
              )}

              {needsManualPlayTap && (
                <div className="camera-status-overlay">
                  <span>
                    {lang === 'vi'
                      ? 'Camera đã sẵn sàng — chạm nút bên dưới để hiển thị hình ảnh'
                      : 'Camera ready — tap below to start live preview'}
                  </span>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleManualPlayTap}
                  >
                    <Play size={17} />{' '}
                    {lang === 'vi' ? 'Bật hiển thị Camera' : 'Start Video Feed'}
                  </button>
                </div>
              )}

              {!cameraStarting && !needsManualPlayTap && (
                <div className={`corner-pill ${lockedCorners ? 'locked' : ''}`}>
                  {lockedCorners
                    ? lang === 'vi'
                      ? '✓ Đã khóa 4 góc phiếu — giữ yên...'
                      : '✓ 4 corners locked — hold steady...'
                    : tr.scan.alignHint}
                </div>
              )}
            </div>

            <div className="camera-bottom-bar">
              <button type="button" className="secondary-btn" onClick={stopCamera}>
                <CameraOff size={16} /> {tr.scan.stopCamera}
              </button>
              <button type="button" className="secondary-btn" onClick={handleFlipCamera}>
                <RefreshCw size={16} /> {tr.scan.switchCamera}
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={cameraStarting || needsManualPlayTap}
                onClick={captureCurrentVideoFrame}
              >
                <Camera size={17} /> {lang === 'vi' ? 'Chụp ngay' : 'Capture'}
              </button>
            </div>
          </div>

          {!cameraActive && (
            <div className="scan-launch-grid">
              <button
                type="button"
                className="primary-btn big-scan-btn"
                onClick={() => startCamera('environment')}
              >
                <Camera size={22} />
                <span>{tr.scan.openCamera}</span>
              </button>

              <button
                type="button"
                className="secondary-btn big-scan-btn"
                style={{ borderColor: '#0d9488', color: '#0f766e' }}
                onClick={() => nativeCameraInputRef.current?.click()}
              >
                <Aperture size={20} />
                <span>{tr.scan.snapNativeCamera}</span>
              </button>

              <button
                type="button"
                className="secondary-btn big-scan-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={20} />
                <span>{tr.scan.uploadPhoto}</span>
              </button>

              <button
                type="button"
                className="ghost-accent-btn"
                onClick={handleGenerateAndScanSample}
              >
                <Sparkles size={17} />
                <span>{tr.scan.tryDemoSheet}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {scanResult && activeGrade && !manualCropMode && (
        <div className="scan-result-card">
          <div className="score-banner">
            <div>
              <div className="score-big">
                {activeGrade.totalScore}{' '}
                <span className="score-denom">/ {activeGrade.maxPossibleScore}</span>
              </div>
              <div className="score-parts">
                SBD: <strong>{selectedSbd || '---'}</strong> • Mã đề:{' '}
                <strong>{selectedExamCode || '---'}</strong>
                {!scanResult.cornersDetected && (
                  <span style={{ color: '#fbbf24', marginLeft: 8 }}>
                    ({lang === 'vi' ? 'Chưa thấy đủ 4 góc đen' : 'Auto-corners fallback'})
                  </span>
                )}
              </div>
            </div>
            <div className="score-counts">
              <span className="badge-ok">✓ {activeGrade.correctCount}</span>
              <span className="badge-err">✗ {activeGrade.wrongCount}</span>
              <span className="badge-warn">∅ {activeGrade.blankCount}</span>
            </div>
          </div>

          {activeGrade.warnings.length > 0 && (
            <div className="warning-stack" style={{ marginTop: 10 }}>
              {activeGrade.warnings.map((w, idx) => (
                <div key={idx} className="warning-item">
                  <AlertTriangle size={15} />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid-2" style={{ marginTop: 10, marginBottom: 6 }}>
            <label className="field-label" style={{ marginBottom: 0 }}>
              <span>{lang === 'vi' ? 'SBD nhận diện' : 'Detected Student ID'}</span>
              <input
                type="text"
                className="text-input mono-input"
                value={selectedSbd}
                onChange={(e) => setSelectedSbd(e.target.value)}
              />
            </label>
            <label className="field-label" style={{ marginBottom: 0 }}>
              <span>
                {lang === 'vi'
                  ? `Mã đề (${sortedKeys.length} mã đáp án)`
                  : `Exam Code (${sortedKeys.length} keys)`}
              </span>
              {sortedKeys.length > 0 ? (
                <div className="seg-row">
                  <input
                    type="text"
                    className="text-input mono-input"
                    style={{ minWidth: 74 }}
                    value={selectedExamCode}
                    placeholder="---"
                    onChange={(e) => setSelectedExamCode(e.target.value)}
                  />
                  <select
                    className="text-input"
                    value={
                      sortedKeys.some((k) => k.examCode === selectedExamCode.trim())
                        ? selectedExamCode.trim()
                        : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) setSelectedExamCode(e.target.value);
                    }}
                  >
                    <option value="">{lang === 'vi' ? 'Chọn mã...' : 'Pick...'}</option>
                    {sortedKeys.map((k) => (
                      <option key={k.id} value={k.examCode}>
                        {k.examCode}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  type="text"
                  className="text-input mono-input"
                  value={selectedExamCode}
                  placeholder="---"
                  onChange={(e) => setSelectedExamCode(e.target.value)}
                />
              )}
            </label>
          </div>

          {scanResult.annotatedDataUrl && (
            <img
              src={scanResult.annotatedDataUrl}
              alt="Graded answer sheet"
              className="annotated-scan-img"
            />
          )}

          <div className="scan-result-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setScanResult(null)}
            >
              <RotateCcw size={16} /> {tr.scan.rescan}
            </button>
            {sourceCanvas && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setManualCropMode(true)}
              >
                <Crop size={16} /> {tr.scan.manualCorners}
              </button>
            )}
            <button type="button" className="primary-btn" onClick={handleConfirmSave}>
              <Check size={17} /> {tr.scan.savePaper}
            </button>
          </div>
        </div>
      )}

      {scanResult && manualCropMode && sourceCanvas && cropQuad && (
        <ManualCornerAdjuster
          lang={lang}
          sourceCanvas={sourceCanvas}
          initialQuad={cropQuad}
          onCancel={() => setManualCropMode(false)}
          onApply={(quad) => processSourceCanvas(sourceCanvas, quad)}
        />
      )}
    </div>
  );
};

const ManualCornerAdjuster: React.FC<{
  lang: 'vi' | 'en';
  sourceCanvas: HTMLCanvasElement;
  initialQuad: CornerQuad;
  onCancel: () => void;
  onApply: (quad: CornerQuad) => void;
}> = ({ lang, sourceCanvas, initialQuad, onCancel, onApply }) => {
  const [quad, setQuad] = useState<CornerQuad>(initialQuad);
  const [draggingKey, setDraggingKey] = useState<keyof CornerQuad | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewUrl = useRef<string>(sourceCanvas.toDataURL('image/jpeg', 0.85)).current;

  const updatePointFromEvent = (clientX: number, clientY: number) => {
    if (!draggingKey || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(sourceCanvas.width, ((clientX - rect.left) / rect.width) * sourceCanvas.width)
    );
    const y = Math.max(
      0,
      Math.min(sourceCanvas.height, ((clientY - rect.top) / rect.height) * sourceCanvas.height)
    );
    setQuad((prev) => ({ ...prev, [draggingKey]: { x, y } }));
  };

  return (
    <div className="section-box">
      <h4 className="sub-heading">
        {lang === 'vi'
          ? 'Kéo 4 điểm tròn vào đúng tâm 4 ô vuông đen ở 4 góc phiếu'
          : 'Drag the 4 handles onto the centers of the 4 black corner squares'}
      </h4>
      <div
        style={{ position: 'relative', touchAction: 'none', userSelect: 'none' }}
        onPointerMove={(e) => updatePointFromEvent(e.clientX, e.clientY)}
        onPointerUp={() => setDraggingKey(null)}
      >
        <img
          src={previewUrl}
          alt="Crop source"
          style={{ width: '100%', display: 'block', borderRadius: 10 }}
        />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${sourceCanvas.width} ${sourceCanvas.height}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <polygon
            points={`${quad.tl.x},${quad.tl.y} ${quad.tr.x},${quad.tr.y} ${quad.br.x},${quad.br.y} ${quad.bl.x},${quad.bl.y}`}
            fill="rgba(20, 184, 166, 0.16)"
            stroke="#14b8a6"
            strokeWidth={Math.max(4, sourceCanvas.width * 0.004)}
          />
          {(['tl', 'tr', 'br', 'bl'] as const).map((k) => {
            const pt: Point2D = quad[k];
            return (
              <circle
                key={k}
                cx={pt.x}
                cy={pt.y}
                r={Math.max(18, sourceCanvas.width * 0.025)}
                fill="#0f766e"
                stroke="#ffffff"
                strokeWidth={Math.max(4, sourceCanvas.width * 0.005)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDraggingKey(k);
                }}
                style={{ cursor: 'grab' }}
              />
            );
          })}
        </svg>
      </div>
      <div className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onCancel}>
          {lang === 'vi' ? 'Hủy' : 'Cancel'}
        </button>
        <button type="button" className="primary-btn" onClick={() => onApply(quad)}>
          {lang === 'vi' ? 'Cắt & Chấm điểm' : 'Warp & Grade'}
        </button>
      </div>
    </div>
  );
};
