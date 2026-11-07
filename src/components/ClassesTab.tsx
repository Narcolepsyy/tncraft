import React, { useRef, useState } from 'react';
import { Download, FileUp, Plus, Trash2, Users } from 'lucide-react';
import { Classroom, Language, Student } from '../types';
import { parseStudentRosterCsv, triggerDownload } from '../utils/exportUtils';
import { uid } from '../storage/db';

interface Props {
  lang: Language;
  classes: Classroom[];
  students: Student[];
  onAddClass: (c: Classroom) => void;
  onDeleteClass: (classId: string) => void;
  onAddStudents: (items: Student[]) => void;
  onDeleteStudent: (studentId: string) => void;
}

export const ClassesTab: React.FC<Props> = ({
  lang,
  classes,
  students,
  onAddClass,
  onDeleteClass,
  onAddStudents,
  onDeleteStudent,
}) => {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const [newClassName, setNewClassName] = useState('');
  const [sbd, setSbd] = useState('');
  const [studentName, setStudentName] = useState('');
  const [roomName, setRoomName] = useState('');
  const csvRef = useRef<HTMLInputElement | null>(null);

  const activeClass = classes.find((c) => c.id === selectedClassId) || classes[0];
  const classStudents = activeClass
    ? students.filter((s) => s.classId === activeClass.id)
    : [];

  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    const created: Classroom = {
      id: uid('cls'),
      name: newClassName.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onAddClass(created);
    setSelectedClassId(created.id);
    setNewClassName('');
  };

  const handleAddSingleStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClass || !sbd.trim() || !studentName.trim()) return;
    onAddStudents([
      {
        id: uid('stu'),
        classId: activeClass.id,
        sbd: sbd.trim(),
        name: studentName.trim(),
        roomName: roomName.trim(),
      },
    ]);
    setSbd('');
    setStudentName('');
  };

  const handleUploadCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeClass) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseStudentRosterCsv(String(reader.result || ''), activeClass.id);
      if (parsed.length > 0) onAddStudents(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDownloadSampleCsv = () => {
    const sample =
      '\uFEFFSBD,HoVaTen,Phong\r\n010001,Nguyễn Minh Anh,P.101\r\n010002,Trần Hoàng Bảo,P.101\r\n010003,Lê Ngọc Châu,P.102\r\n';
    triggerDownload(
      new Blob([sample], { type: 'text/csv;charset=utf-8' }),
      'Mau_DanhSachHocSinh_TNCraft.csv'
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>{lang === 'vi' ? 'Quản lý Lớp & Học sinh' : 'Classes & Student Rosters'}</h2>
      </div>

      <form onSubmit={handleCreateClass} className="inline-add-bar">
        <input
          type="text"
          className="text-input"
          placeholder={lang === 'vi' ? 'Tên lớp mới (VD: 12A2)...' : 'New class name (e.g. Grade 12A)...'}
          value={newClassName}
          onChange={(e) => setNewClassName(e.target.value)}
        />
        <button type="submit" className="primary-btn">
          <Plus size={16} /> {lang === 'vi' ? 'Tạo lớp' : 'Add'}
        </button>
      </form>

      {classes.length === 0 ? (
        <div className="empty-card">
          {lang === 'vi' ? 'Chưa có lớp học nào.' : 'No classes created yet.'}
        </div>
      ) : (
        <>
          <div className="chip-row">
            {classes.map((c) => {
              const count = students.filter((s) => s.classId === c.id).length;
              const isSelected = activeClass?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedClassId(c.id)}
                >
                  <Users size={14} />
                  <span>
                    {c.name} ({count})
                  </span>
                </button>
              );
            })}
          </div>

          {activeClass && (
            <div className="section-box">
              <div className="row-between" style={{ marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>{activeClass.name}</h3>
                <div className="action-strip" style={{ margin: 0 }}>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => csvRef.current?.click()}
                  >
                    <FileUp size={15} /> {lang === 'vi' ? 'Nhập CSV' : 'Import CSV'}
                  </button>
                  <input
                    ref={csvRef}
                    type="file"
                    accept=".csv,.txt"
                    style={{ display: 'none' }}
                    onChange={handleUploadCsv}
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={handleDownloadSampleCsv}
                  >
                    <Download size={15} /> {lang === 'vi' ? 'File mẫu' : 'Sample'}
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => onDeleteClass(activeClass.id)}
                    title="Delete class"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>

              <form onSubmit={handleAddSingleStudent} className="student-add-grid">
                <input
                  type="text"
                  className="text-input mono-input"
                  placeholder={lang === 'vi' ? 'SBD (VD: 010006)' : 'Student ID'}
                  value={sbd}
                  onChange={(e) => setSbd(e.target.value)}
                  required
                />
                <input
                  type="text"
                  className="text-input"
                  placeholder={lang === 'vi' ? 'Họ và tên học sinh' : 'Student Full Name'}
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  required
                />
                <input
                  type="text"
                  className="text-input"
                  placeholder={lang === 'vi' ? 'Phòng' : 'Room'}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
                <button type="submit" className="primary-btn">
                  <Plus size={16} />
                </button>
              </form>

              {classStudents.length === 0 ? (
                <p className="muted-text" style={{ textAlign: 'center', padding: 16 }}>
                  {lang === 'vi'
                    ? 'Chưa có học sinh. Thêm từng em hoặc nhập file CSV danh sách lớp.'
                    : 'No students yet. Add manually or import a CSV roster.'}
                </p>
              ) : (
                <div className="card-list" style={{ marginTop: 12 }}>
                  {classStudents.map((stu) => (
                    <div key={stu.id} className="item-card compact">
                      <div className="item-card-main">
                        <span className="code-badge">{stu.sbd}</span>
                        <div className="item-card-info">
                          <h4>{stu.name}</h4>
                          {stu.roomName && <p>{stu.roomName}</p>}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => onDeleteStudent(stu.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
