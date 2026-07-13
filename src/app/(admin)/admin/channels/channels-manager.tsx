"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertChannelConfig,
  deleteChannelConfig,
  type ChannelConfigDto,
} from "@/actions/channels";
import { CHANNEL_LABELS, CREDENTIAL_FIELDS, type CredentialField } from "@/lib/channels/registry";
import type { ChannelKind } from "@/lib/channels/connector";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const CHANNELS: ChannelKind[] = ["SMS", "WHATSAPP", "MESSENGER", "INSTAGRAM"];

type Editing = ChannelConfigDto | { create: true; channel: ChannelKind } | null;

export function ChannelsManager({ configs }: { configs: ChannelConfigDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  const byChannel = new Map(configs.map((c) => [c.channel, c]));

  function remove(id: string, channel: string) {
    startTransition(async () => {
      try {
        await deleteChannelConfig(id);
        toast({ title: `${channel} channel removed`, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't remove",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  if (editing) {
    const initial =
      "create" in editing
        ? {
            id: "",
            channel: editing.channel,
            phoneOrHandle: "",
            isActive: true,
            webhookSlug: "",
            webhookUrl: "",
            lastInboundAt: null,
            lastOutboundAt: null,
            updatedAt: "",
          }
        : editing;
    return (
      <Editor
        initial={initial}
        isNew={"create" in editing}
        pending={pending}
        onCancel={() => setEditing(null)}
        onSave={(v) => {
          startTransition(async () => {
            try {
              await upsertChannelConfig(v);
              toast({ title: `${v.channel} channel saved`, variant: "success" });
              setEditing(null);
              router.refresh();
            } catch (e) {
              toast({
                title: "Couldn't save",
                description: e instanceof Error ? e.message : undefined,
                variant: "error",
              });
            }
          });
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {CHANNELS.map((ch) => {
        const existing = byChannel.get(ch);
        return (
          <div
            key={ch}
            className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[13px] font-semibold">{CHANNEL_LABELS[ch]}</div>
                {existing ? (
                  <div className="text-[12px] text-[var(--color-neutral-600)]">
                    {existing.phoneOrHandle}
                  </div>
                ) : (
                  <div className="text-[12px] text-[var(--color-neutral-500)]">
                    Not configured
                  </div>
                )}
              </div>
              {existing ? (
                <span
                  className={`text-[10px] uppercase-label ${
                    existing.isActive ? "text-emerald-700" : "text-[var(--color-neutral-500)]"
                  }`}
                >
                  {existing.isActive ? "Active" : "Off"}
                </span>
              ) : null}
            </div>
            {existing ? (
              <>
                <div className="text-[11px] text-[var(--color-neutral-500)] mb-1">Webhook URL</div>
                <div className="text-[11px] font-mono break-all bg-[var(--color-light-gray)] rounded-md p-2 mb-3">
                  {existing.webhookUrl}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
                  <div>
                    <div className="text-[var(--color-neutral-500)]">Last inbound</div>
                    <div>
                      {existing.lastInboundAt
                        ? new Date(existing.lastInboundAt).toLocaleString()
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--color-neutral-500)]">Last outbound</div>
                    <div>
                      {existing.lastOutboundAt
                        ? new Date(existing.lastOutboundAt).toLocaleString()
                        : "—"}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setEditing(existing)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => remove(existing.id, ch)}
                  >
                    Remove
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing({ create: true, channel: ch })}>
                Connect
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Editor({
  initial,
  isNew,
  pending,
  onCancel,
  onSave,
}: {
  initial: ChannelConfigDto & { channel: string };
  isNew: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (v: {
    id?: string;
    channel: ChannelKind;
    phoneOrHandle: string;
    isActive: boolean;
    credentials: Record<string, string>;
  }) => void;
}) {
  const channel = initial.channel as ChannelKind;
  const fields: CredentialField[] = CREDENTIAL_FIELDS[channel];
  const [phoneOrHandle, setPhoneOrHandle] = useState(initial.phoneOrHandle);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, ""]))
  );

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-2xl space-y-3">
      <div className="text-[13px] font-semibold mb-2">
        {CHANNEL_LABELS[channel]} — {isNew ? "Connect" : "Update"}
      </div>
      <div className="space-y-1">
        <Label htmlFor="phoneOrHandle">Phone / handle</Label>
        <Input
          id="phoneOrHandle"
          value={phoneOrHandle}
          onChange={(e) => setPhoneOrHandle(e.target.value)}
          placeholder={channel === "SMS" || channel === "WHATSAPP" ? "+15551234567" : "Meta page id"}
        />
      </div>
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
            <Input
              id={`cred-${f.key}`}
              type={f.isSecret ? "password" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={isNew ? "" : "leave blank to keep current value"}
            />
            {f.helpText ? (
              <p className="text-[11px] text-[var(--color-neutral-500)]">{f.helpText}</p>
            ) : null}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Active
      </label>
      <div className="flex gap-3 pt-2">
        <Button
          disabled={pending || !phoneOrHandle.trim() || (isNew && fields.some((f) => !values[f.key]))}
          onClick={() =>
            onSave({
              id: initial.id || undefined,
              channel,
              phoneOrHandle,
              isActive,
              credentials: values,
            })
          }
        >
          {pending ? "Saving…" : isNew ? "Connect" : "Save changes"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
