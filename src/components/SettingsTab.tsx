import React, { useRef } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { AppSettings } from '../types';
import { AppDatabaseState } from '../storage/db';
import { triggerDownload } from '../utils/exportUtils';

interface Props {
  settings: AppSettings;
  fullState: AppDatabaseState;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onImportState: (next: AppDatabaseState) => void;
  onResetDemo: () => void;
}

export const SettingsTab: React.FC<Props> = ({
  settings,
  fullState,
  onUpdateSettings,
  onImportState,
  onResetDemo,
}) => {
  const lang = settings.language;
  const restoreRef = useRef<HTMLInputElement | null>(null);

  const handleBackupJson = () => {
    const json = JSON.stringify(fullState, null, 2);
    triggerDownload(
      new Blob([json], { type: 'application/json' }),
      `TNCraft_Backup_${new Date().toISOString().slice(0, 10)}.json`
    );
  };

  const handleRestoreJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        if (parsed && Array.isArray(parsed.contests)) {
          onImportState(parsed);
        }
      } catch {
        alert(lang === 'vi' ? 'File sao lưu không hợp lệ.' : 'Invalid backup JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>{lang === 'vi' ? 'Cài đặt hệ thống' : 'App & Scanner Settings'}</h2>
      </div>

      <div className="section-box">
        <label className="field-label">
          <span>{lang === 'vi' ? 'Ngôn ngữ hiển thị / Language' : 'Language'}</span>
          <select
            className="text-input"
            value={settings.language}
            onChange={(e) => onUpdateSettings({ language: e.target.value as 'vi' | 'en' })}
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="field-label">
          <span>
            {lang === 'vi'
              ? 'Tự động chụp khi khóa đủ 4 góc (Auto-Scan)'
              : 'Auto-Capture Delay When 4 Corners Lock'}
          </span>
          <select
            className="text-input"
            value={settings.autoCaptureDelayMs}
            onChange={(e) =>
              onUpdateSettings({ autoCaptureDelayMs: Number(e.target.value) as any })
            }
          >
            <option value={0}>{lang === 'vi' ? 'Tắt (Chỉ chụp khi bấm nút)' : 'Off (Manual shutter)'}</option>
            <option value={600}>0.6s</option>
            <option value={1000}>1.0s</option>
            <option value={1500}>1.5s</option>
            <option value={2000}>2.0s</option>
          </select>
        </label>

        <label className="field-label">
          <span>
            {lang === 'vi'
              ? 'Chế độ lọc vết tẩy chì (Erase Sensitivity)'
              : 'Pencil Erase Filtering'}
          </span>
          <select
            className="text-input"
            value={settings.eraseMode}
            onChange={(e) =>
              onUpdateSettings({ eraseMode: e.target.value as 'normal' | 'high' })
            }
          >
            <option value="normal">
              {lang === 'vi' ? 'Chuẩn (Cảnh báo nếu tô 2 ô đậm ngang nhau)' : 'Standard'}
            </option>
            <option value="high">
              {lang === 'vi' ? 'Nhạy cao (Ưu tiên ô tô đậm hơn khi học sinh tẩy mờ)' : 'High (Ignore light smudges)'}
            </option>
          </select>
        </label>

        <label className="check-row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={settings.overrideDuplicateSbd}
            onChange={(e) => onUpdateSettings({ overrideDuplicateSbd: e.target.checked })}
          />
          <span>
            {lang === 'vi'
              ? 'Ghi đè bài cũ nếu quét trùng Số báo danh'
              : 'Override existing paper when scanning duplicate Student ID'}
          </span>
        </label>

        <label className="check-row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={settings.vibrateOnScan}
            onChange={(e) => onUpdateSettings({ vibrateOnScan: e.target.checked })}
          />
          <span>
            {lang === 'vi' ? 'Rung phản hồi sau khi chấm xong' : 'Haptic vibration on scan'}
          </span>
        </label>
      </div>

      <div className="section-box">
        <h4 className="sub-heading">
          {lang === 'vi' ? 'Sao lưu & Khôi phục dữ liệu (Offline)' : 'Offline Data Backup & Restore'}
        </h4>
        <div className="action-strip">
          <button type="button" className="secondary-btn" onClick={handleBackupJson}>
            <Download size={16} /> {lang === 'vi' ? 'Tải file sao lưu (.json)' : 'Backup JSON'}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => restoreRef.current?.click()}
          >
            <Upload size={16} /> {lang === 'vi' ? 'Khôi phục từ file' : 'Restore JSON'}
          </button>
          <input
            ref={restoreRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleRestoreJson}
          />
          <button type="button" className="secondary-btn" onClick={onResetDemo}>
            <RotateCcw size={16} /> {lang === 'vi' ? 'Khôi phục dữ liệu mẫu' : 'Reset Demo Data'}
          </button>
        </div>
      </div>

      <div className="section-box muted-card">
        <strong>TNCraft v1.0 — Unlimited Offline Edition</strong>
        <p style={{ margin: '6px 0 0', fontSize: 13 }}>
          {lang === 'vi'
            ? 'Không giới hạn số lượt quét • Chạy hoàn toàn ngoại tuyến trên iPhone Safari PWA • Dữ liệu lưu riêng tư ngay trên máy của bạn.'
            : 'Unlimited scans • 100% private on-device storage • Optimized for iPhone Home Screen PWA.'}
        </p>
      </div>
    </div>
  );
};
