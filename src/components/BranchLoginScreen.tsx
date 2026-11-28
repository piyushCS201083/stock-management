import React, { useState } from 'react';
import {
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import {
  BRANCH_LOGIN_ACCOUNTS,
  BranchAuthSession,
} from '../types/stock';
import { apiBranchLogin } from '../services/api';

interface BranchLoginScreenProps {
  onAuthenticated: (token: string, session: BranchAuthSession) => void;
  onOpenAdminPortal: () => void;
  isAdminAuthenticated: boolean;
  notice?: string | null;
}

export const BranchLoginScreen: React.FC<BranchLoginScreenProps> = ({
  onAuthenticated,
  onOpenAdminPortal,
  isAdminAuthenticated,
  notice,
}) => {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMeta = BRANCH_LOGIN_ACCOUNTS.find(
    (acc) => acc.loginId === loginId.trim().toLowerCase()
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanId = loginId.trim().toLowerCase();
    if (!cleanId || !password) {
      setError('Enter both Login ID and Password.');
      return;
    }

    setIsSubmitting(true);
    const res = await apiBranchLogin(cleanId, password);
    setIsSubmitting(false);

    if (res.success && res.token && res.session) {
      setPassword('');
      onAuthenticated(res.token, res.session);
    } else {
      setError(res.error || 'Invalid Login ID or password.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-900 font-sans">
      {/* Minimal Header */}
      <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-sm sm:text-base font-black tracking-tight text-slate-900">
              Stock Register
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600">
              <Lock className="w-3 h-3 text-slate-500" />
              <span>Branch Access Required</span>
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenAdminPortal}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isAdminAuthenticated
                ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {isAdminAuthenticated ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-slate-600" />
            )}
            <span>{isAdminAuthenticated ? 'Admin Console' : 'Admin Login'}</span>
          </button>
        </div>
      </header>

      {/* Main Centered Login Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="bg-slate-900 text-white px-6 py-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-400/30 flex items-center justify-center text-blue-300 shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight">
                  Branch & Master Sign In
                </h1>
                <p className="text-xs text-slate-300 mt-0.5">
                  Sign in with your assigned branch Login ID or master ID to view inventory.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5 text-xs">
            {notice && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 font-medium">
                {notice}
              </div>
            )}

            {/* Account Quick Select (Login IDs only) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  Quick Select ID
                </span>
                <span className="text-[11px] text-slate-500 text-right">
                  Or type any custom user ID created by Admin
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {BRANCH_LOGIN_ACCOUNTS.map((acc) => {
                  const isActive = loginId.trim().toLowerCase() === acc.loginId;
                  const isMaster = acc.role === 'master';
                  return (
                    <button
                      key={acc.loginId}
                      type="button"
                      onClick={() => {
                        setLoginId(acc.loginId);
                        if (error) setError(null);
                      }}
                      className={`text-left px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                        isActive
                          ? isMaster
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-blue-50 text-blue-950 border-blue-500 ring-2 ring-blue-500/20'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono font-extrabold text-xs">
                          {acc.loginId}
                        </span>
                        {isMaster ? (
                          <ShieldCheck
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isActive ? 'text-amber-400' : 'text-slate-500'
                            }`}
                          />
                        ) : (
                          <Building2
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isActive ? 'text-blue-600' : 'text-slate-400'
                            }`}
                          />
                        )}
                      </div>
                      <div
                        className={`text-[10px] mt-0.5 truncate font-medium ${
                          isActive && isMaster ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {acc.shortLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-1 border-t border-slate-100">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Login ID
                </label>
                <input
                  type="text"
                  required
                  value={loginId}
                  onChange={(e) => {
                    setLoginId(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter branch letter (c, m, y, s, v), custom user ID, or administrator"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {selectedMeta ? (
                  <p className="mt-1 text-[11px] font-medium text-blue-700">
                    Access Scope: {selectedMeta.label}
                  </p>
                ) : loginId.trim() ? (
                  <p className="mt-1 text-[11px] font-medium text-slate-500">
                    Custom branch user Login ID — branch & stock permissions verified on sign-in
                  </p>
                ) : null}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full pl-3 pr-10 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Unlock className="w-4 h-4 animate-pulse" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Sign In to Stock Register</span>
                  </>
                )}
              </button>
            </form>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Need to manage or rotate branch passwords?</span>
              <button
                type="button"
                onClick={onOpenAdminPortal}
                className="font-bold text-slate-800 hover:text-blue-700 underline cursor-pointer"
              >
                Open Admin Password Manager
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
