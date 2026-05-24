import { useState } from 'react';
import { Navbar } from '../components/Navbar.jsx';
import { SYLLABUS_PDFS } from '../utils/syllabus.js';

export function SyllabusPage() {
  const [activeExam, setActiveExam] = useState("UKPSC");
  const syllabusPdfs = SYLLABUS_PDFS[activeExam] || [];

  return (
    <div className="page" style={{background:"var(--cream)"}}>
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8 fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-black" style={{color:"var(--navy)"}}> Complete Syllabus</h1>
          <p className="text-gray-500 text-sm mt-1">Exam-wise detailed syllabus</p>
        </div>

        {/* Exam Tabs */}
        <div className="flex gap-3 mb-6">
          {["UKPSC","UKSSSC"].map(ex => (
            <button key={ex} className={`px-6 py-2 rounded-full font-bold transition-colors ${activeExam===ex ? "text-white" : "bg-white text-gray-600 border"}`}
              style={activeExam===ex ? {background:"var(--navy)"} : {}}
              onClick={() => setActiveExam(ex)}>
              {ex}
            </button>
          ))}
        </div>

        {/* Syllabus PDFs */}
        <div className="space-y-4">
          {syllabusPdfs.length === 0 ? (
            <div className="card text-center">
              <h3 className="font-black text-base" style={{color:"var(--navy)"}}>PDF not uploaded yet</h3>
              <p className="text-sm text-gray-500 mt-1">Add the syllabus PDF in public/syllabus and it will appear here after deployment.</p>
            </div>
          ) : syllabusPdfs.map((pdf) => (
            <div key={pdf.href} className="card overflow-hidden">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-black text-base" style={{color:"var(--navy)"}}>{pdf.title}</h3>
                  <p className="text-xs text-gray-400 mt-1">Upload PDF as public/syllabus/{pdf.fileName}</p>
              </div>
                <a
                  className="btn-primary text-center"
                  href={pdf.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  View PDF
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
