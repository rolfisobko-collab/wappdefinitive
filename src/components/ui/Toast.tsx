"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const remove = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const styles = {
    success: "border-l-4 border-[#25d366] bg-white",
    error:   "border-l-4 border-red-500 bg-white",
    info:    "border-l-4 border-[#00a884] bg-white",
  };
  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-[#25d366] flex-shrink-0" />,
    error:   <AlertCircle  className="w-4 h-4 text-red-500 flex-shrink-0" />,
    info:    <Info         className="w-4 h-4 text-[#00a884] flex-shrink-0" />,
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0">
        {toasts.map((t) => (
          <div key={t.id} className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm fade-in",
            "text-[#111b21]", styles[t.type]
          )}>
            {icons[t.type]}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="text-[#667781] hover:text-[#111b21] ml-1 flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
