import { Smartphone } from "lucide-react";
import { goToPhone, inZomelloApp } from "../places";

/** On a computer's or server's page inside the phone app: back to the boards stored on the phone. */
export function PhoneBoardsButton({ className = "btn ghost" }: { className?: string }) {
  if (!inZomelloApp()) return null;
  return (
    <button type="button" className={className} onClick={() => goToPhone()}>
      <Smartphone size={16} /> Boards on this phone
    </button>
  );
}
