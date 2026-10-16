import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';

export default function Page({ active }: { active: boolean }) {
  return (
    <main className={`p-4 ${active ? 'bg-[#1c2735] text-white' : 'bg-gray-100'}`}>
      <h1 className="text-[13px] p-[13px] rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.2)] z-[1300]">Settings</h1>
      <p className="text-[color:var(--color-text-muted)] gap-[var(--space-4)]">Plan</p>
      <input className="border-[#dce3eb] border" />
      <select><option>One</option></select>
      <Button>Save</Button>
      <Dialog.Root>
        <Dialog.Trigger>Open</Dialog.Trigger>
      </Dialog.Root>
    </main>
  );
}
