const ACTION_LABEL: Record<string, string> = {
  agent_tap: "Tap",
  tap: "Tap",
  swipe_up: "Swipe up",
  swipe_down: "Swipe down",
  swipe_left: "Swipe left",
  swipe_right: "Swipe right",
  swipe: "Swipe",
  type: "Type",
  back: "Back",
  wait: "Wait",
  sleep: "Wait",
  step: "Action",
};

export function humanizeAction(raw: string | null | undefined): string {
  if (!raw) return "Action";
  const key = raw.toLowerCase().trim();
  if (ACTION_LABEL[key]) return ACTION_LABEL[key];
  const cleaned = key.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Action";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
