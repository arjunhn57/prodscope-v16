import { motion } from "framer-motion";
import { Key, Copy, Check, Shield } from "lucide-react";
import { TopBar } from "../../components/layout/TopBar";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useState } from "react";
import { useAuthStore } from "../../stores/auth";

export function SettingsPage() {
  const token = useAuthStore((s) => s.token);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (token) {
      navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const maskedToken = token
    ? `${token.slice(0, 12)}${"•".repeat(20)}${token.slice(-8)}`
    : "Not authenticated";

  return (
    <div className="flex flex-col min-h-dvh">
      <TopBar title="Settings" />

      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-4 sm:space-y-6">
        {/* API Key */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                API Access
              </CardTitle>
            </CardHeader>
            <div className="space-y-3">
              <div className="bg-bg-tertiary p-3 flex items-center gap-3 rounded-lg">
                <code className="text-xs text-text-secondary flex-1 truncate font-mono">
                  {maskedToken}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  aria-label={copied ? "API key copied to clipboard" : "Copy API key to clipboard"}
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-text-muted">
                Use this token in the Authorization header for API requests.
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Plan */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Plan & Usage
              </CardTitle>
            </CardHeader>
            <div className="bg-bg-tertiary p-4 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-primary font-medium">Current Plan</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent font-medium">
                  Enterprise
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">Analyses this month</span>
                <span className="text-text-primary">Unlimited</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">Steps per run</span>
                <span className="text-text-primary">80</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">AI analysis</span>
                <span className="text-success">Enabled</span>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
