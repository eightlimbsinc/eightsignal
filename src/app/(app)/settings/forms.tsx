"use client";

import { useActionState } from "react";
import { Input, Select } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/shared/form";
import { addAllowedDomain, setOwnPassword, updateOwnName } from "./actions";

export function DomainForm() {
  const [state, action] = useActionState(addAllowedDomain, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input name="domain" placeholder="company.com" required aria-label="Email domain" />
        <Select name="default_role" defaultValue="viewer" className="w-32" aria-label="Default role">
          <option value="viewer">viewer</option><option value="analyst">analyst</option>
        </Select>
        <SubmitButton size="default" variant="secondary">Add</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function NameForm({ name }: { name: string }) {
  const [state, action] = useActionState(updateOwnName, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input name="full_name" defaultValue={name} placeholder="Full name" aria-label="Full name" />
        <SubmitButton size="default" variant="secondary">Save</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(setOwnPassword, {});
  return (
    <form action={action} className="flex flex-col gap-2" autoComplete="off">
      <Input name="password" type="password" placeholder="New password (12+ characters)" autoComplete="new-password" required aria-label="New password" />
      <Input name="confirm" type="password" placeholder="Repeat new password" autoComplete="new-password" required aria-label="Repeat new password" />
      <SubmitButton size="sm" variant="secondary">Set password</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
