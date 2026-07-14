'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { MissionInstructions } from '@outbound-call/shared';

interface InstructionsStepProps {
  data: MissionInstructions;
  errors: Record<string, string>;
  onChange: <K extends keyof MissionInstructions>(
    field: K,
    value: MissionInstructions[K],
  ) => void;
}

function EditableList({
  label,
  items,
  onChange,
  placeholder,
  minItems = 0,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  minItems?: number;
}) {
  const addItem = () => onChange([...items, '']);

  const removeItem = (index: number) => {
    if (items.length <= minItems) return;
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, value: string) => {
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={placeholder}
              className="flex-1 h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-firm-accent"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              disabled={items.length <= minItems}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={addItem}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add item
      </Button>
    </div>
  );
}

export function InstructionsStep({ data, errors, onChange }: InstructionsStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Mission Instructions</h2>
        <p className="text-sm text-slate-500 mt-1">
          Define what the AI agent should accomplish during this call. These have been
          pre-filled from the Open Insurance Claim template.
        </p>
      </div>

      <Textarea
        id="goal"
        label="Goal *"
        value={data.goal}
        onChange={(e) => onChange('goal', e.target.value)}
        error={errors.goal}
        placeholder="What should the AI agent accomplish?"
      />

      <EditableList
        label="Objectives"
        items={data.objectives}
        onChange={(items) => onChange('objectives', items)}
        placeholder="Describe an objective..."
      />

      <EditableList
        label="Success Criteria"
        items={data.successCriteria}
        onChange={(items) => onChange('successCriteria', items)}
        placeholder="What defines success?"
      />

      <EditableList
        label="Required Information to Collect"
        items={data.requiredInformation}
        onChange={(items) => onChange('requiredInformation', items)}
        placeholder="What information must be gathered?"
      />

      <EditableList
        label="Allowed Disclosures"
        items={data.allowedDisclosures}
        onChange={(items) => onChange('allowedDisclosures', items)}
        placeholder="What can the AI disclose?"
      />

      <EditableList
        label="Restricted Topics (cannot be empty)"
        items={data.restrictedTopics}
        onChange={(items) => onChange('restrictedTopics', items)}
        placeholder="Topics the AI must avoid..."
        minItems={1}
      />

      <EditableList
        label="Escalation Conditions"
        items={data.escalationConditions}
        onChange={(items) => onChange('escalationConditions', items)}
        placeholder="When should the AI escalate?"
      />

      <Textarea
        id="additionalInstructions"
        label="Additional Instructions"
        value={data.additionalInstructions ?? ''}
        onChange={(e) => onChange('additionalInstructions', e.target.value)}
        placeholder="Any additional guidance for the AI agent..."
      />
    </div>
  );
}
