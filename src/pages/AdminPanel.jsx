import { useState } from 'react';
import { Navbar } from '../components/Navbar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useRouter } from '../context/RouterContext.jsx';
import { AdminCoupons } from './AdminCoupons.jsx';
import { AdminDaily } from './AdminDaily.jsx';
import { AdminFolders } from './AdminFolders.jsx';
import { AdminQuestions } from './AdminQuestions.jsx';
import { AdminReports } from './AdminReports.jsx';
import { AdminSets } from './AdminSets.jsx';
import { AdminStudents } from './AdminStudents.jsx';

export function AdminPanel() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState("questions");

  if (!user?.isAdmin) return (
    <div className="min-h-screen flex items-center justify-center" style={{background:"var(--cream)"}}>
      <div className="card text-center max-w-sm">
        <div className="text-4xl mb-3"></div>
        <h2 className="font-black text-xl mb-2">Access Denied</h2>
        <p className="text-gray-500 text-sm mb-4">Only admins can access this page.</p>
        <button className="btn-primary" onClick={() => navigate("/dashboard")}>Go to Dashboard</button>
      </div>
    </div>
  );

  const tabs = [
    { id:"questions", label:" Questions" },
    { id:"folders", label:" Folders" },
    { id:"coupons", label:" Coupons" },
    { id:"sets", label:" Practice Sets" },
    { id:"daily", label:" Daily Challenge" },
    { id:"reports", label:" Reports" },
    { id:"students", label:" Students" },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{background:"#f8fafc"}}>
      <Navbar />
      <div className="flex flex-1">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 bg-white border-r p-4 hidden md:block">
          <div className="font-black text-lg mb-4" style={{color:"var(--navy)"}}>Admin Panel</div>
          <div className="space-y-1">
            {tabs.map(t => (
              <div key={t.id} className={`sidebar-link text-sm ${activeTab===t.id?"active":""}`} onClick={() => setActiveTab(t.id)}>{t.label}</div>
            ))}
          </div>
        </div>

        {/* Mobile tabs */}
        <div className="md:hidden w-full">
          <div className="flex overflow-x-auto bg-white border-b p-2 gap-2">
            {tabs.map(t => (
              <button key={t.id} className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${activeTab===t.id?"text-white":"text-gray-600"}`}
                style={activeTab===t.id?{background:"var(--saffron)"}:{}}
                onClick={() => setActiveTab(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 md:p-6 overflow-auto">
          {activeTab === "questions" && <AdminQuestions />}
          {activeTab === "folders" && <AdminFolders />}
          {activeTab === "coupons" && <AdminCoupons />}
          {activeTab === "sets" && <AdminSets />}
          {activeTab === "daily" && <AdminDaily />}
          {activeTab === "reports" && <AdminReports />}
          {activeTab === "students" && <AdminStudents />}
        </div>
      </div>
    </div>
  );
}
