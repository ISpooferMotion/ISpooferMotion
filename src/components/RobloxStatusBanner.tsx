import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';

interface RobloxStatusBannerProps {
  isVisible: boolean;
}

export function RobloxStatusBanner({ isVisible }: RobloxStatusBannerProps) {
  // simple banner that drops down when roblox APIs are having a bad time
  // helps prevent users from thinking the app is broken when it's actually roblox's fault
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="w-full px-4 pt-4 shrink-0"
        >
          <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 flex items-center justify-center gap-3">
            <AlertCircle size={18} className="text-danger shrink-0" strokeWidth={2.5} />
            <span className="text-sm font-medium text-danger truncate text-center">
              Roblox APIs are currently experiencing issues. Some features may be unavailable.
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
