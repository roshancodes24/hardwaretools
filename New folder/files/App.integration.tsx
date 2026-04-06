// ─── App.tsx integration guide ────────────────────────────────────────────────
//
// 1. Add 'home' to your Tab type (if not already there):
//
//   type Tab = 'home' | 'pos' | 'inventory' | 'purchase' | 'adjustment';
//
//
// 2. Import the Sidebar:
//
//   import { Sidebar } from './Sidebar';
//
//
// 3. Replace your existing top-bar tab strip with a side-by-side layout.
//    Find the root return() in App.tsx and wrap it like this:
//
//   return (
//     <div style={{ display: 'flex', minHeight: '100vh' }}>
//
//       <Sidebar
//         activeTab={activeTab}
//         onTabChange={setActiveTab}
//         userRole={session?.role}   // 'admin' | 'cashier'
//       />
//
//       {/* Everything that was previously inside your full-width layout */}
//       <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
//
//         {/* Optional: keep a slim top bar for date + right-side actions */}
//         <div style={{
//           background: '#1c1917', height: 48, display: 'flex',
//           alignItems: 'center', justifyContent: 'flex-end',
//           padding: '0 20px', gap: 16, flexShrink: 0,
//         }}>
//           <span style={{ color: '#a8a29e', fontSize: 13 }}>
//             {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
//           </span>
//         </div>
//
//         {/* Main content area — your existing views unchanged */}
//         <main style={{ flex: 1, background: '#f5f4f0', overflowY: 'auto' }}>
//           {activeTab === 'home'       && <HomeView />}
//           {activeTab === 'pos'        && <POSView ... />}
//           {activeTab === 'inventory'  && <InventoryView ... />}
//           {activeTab === 'purchase'   && <PurchaseView ... />}
//           {activeTab === 'adjustment' && <AdjustmentView ... />}
//         </main>
//
//       </div>
//     </div>
//   );
//
//
// 4. HomeView stub (add to App.tsx or its own file):
//
//   function HomeView() {
//     return (
//       <div style={{ padding: 24 }}>
//         <h2 style={{ fontSize: 18, fontWeight: 500, color: '#1c1917', marginBottom: 16 }}>
//           Dashboard
//         </h2>
//         <p style={{ color: '#78716c' }}>Summary view coming soon.</p>
//       </div>
//     );
//   }
//
//
// 5. Remove the old tab buttons from the top bar — the Sidebar handles navigation now.
//    The tab state (activeTab / setActiveTab) stays exactly where it is.
//
// ─────────────────────────────────────────────────────────────────────────────
