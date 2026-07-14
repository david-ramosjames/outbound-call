import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const getApprovedCaseFieldInput = z.object({
  missionId: z.string().uuid(),
  fieldKey: z.string(),
});

const recordCollectedFieldInput = z.object({
  fieldKey: z.string(),
  value: z.string(),
  confirmationStatus: z.enum(['confirmed', 'tentative', 'unconfirmed']),
  representativeAttribution: z.string(),
  supportingQuote: z.string(),
});

const recordMissingInformationInput = z.object({
  missingField: z.string(),
  reason: z.string(),
  effectOnCompletion: z.string(),
  suggestedNextStep: z.string(),
});

const recordRequestedDocumentInput = z.object({
  documentName: z.string(),
  deliveryMethod: z.string(),
  destination: z.string(),
  deadline: z.string().nullable(),
});

const recordEscalationInput = z.object({
  reason: z.string(),
  representativeRequest: z.string(),
  recommendedHumanAction: z.string(),
});

const endCallInput = z.object({
  completionStatus: z.enum(['success', 'partial_success', 'failure', 'human_follow_up']),
  closingReason: z.string(),
});

describe('Grok Tool Input Validation', () => {
  describe('get_approved_case_field', () => {
    it('accepts valid input', () => {
      const result = getApprovedCaseFieldInput.safeParse({
        missionId: '550e8400-e29b-41d4-a716-446655440000',
        fieldKey: 'client_full_name',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID', () => {
      const result = getApprovedCaseFieldInput.safeParse({
        missionId: 'not-a-uuid',
        fieldKey: 'client_full_name',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('record_collected_field', () => {
    it('accepts valid input', () => {
      const result = recordCollectedFieldInput.safeParse({
        fieldKey: 'claim_number',
        value: 'CLM-2024-123456',
        confirmationStatus: 'confirmed',
        representativeAttribution: 'Claims representative Jane',
        supportingQuote: 'Your claim number is CLM-2024-123456',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid confirmation status', () => {
      const result = recordCollectedFieldInput.safeParse({
        fieldKey: 'claim_number',
        value: 'CLM-2024-123456',
        confirmationStatus: 'maybe',
        representativeAttribution: 'Jane',
        supportingQuote: 'quote',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('record_missing_information', () => {
    it('accepts valid input', () => {
      const result = recordMissingInformationInput.safeParse({
        missingField: 'policy_number',
        reason: 'Representative cannot locate policy without number',
        effectOnCompletion: 'Cannot open claim without policy number',
        suggestedNextStep: 'Ask client for policy number or insurance card',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('record_requested_document', () => {
    it('accepts valid input with deadline', () => {
      const result = recordRequestedDocumentInput.safeParse({
        documentName: 'Police Report',
        deliveryMethod: 'fax',
        destination: '+15559876543',
        deadline: '2024-02-01',
      });
      expect(result.success).toBe(true);
    });

    it('accepts null deadline', () => {
      const result = recordRequestedDocumentInput.safeParse({
        documentName: 'Letter of Representation',
        deliveryMethod: 'mail',
        destination: '123 Main St, Austin TX 78701',
        deadline: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('record_escalation', () => {
    it('accepts valid input', () => {
      const result = recordEscalationInput.safeParse({
        reason: 'Representative requested to speak with attorney',
        representativeRequest: 'Please have the attorney call us directly',
        recommendedHumanAction: 'Attorney should call claims department at ext 4521',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('end_call', () => {
    it('accepts valid completion statuses', () => {
      for (const status of ['success', 'partial_success', 'failure', 'human_follow_up']) {
        const result = endCallInput.safeParse({
          completionStatus: status,
          closingReason: 'Call completed normally',
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid status', () => {
      const result = endCallInput.safeParse({
        completionStatus: 'aborted',
        closingReason: 'test',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Tool Authorization', () => {
  const approvedContext: Array<{
    field: string;
    label: string;
    value: string;
    included: boolean;
    missionSpecificValue?: string;
  }> = [
    { field: 'client_full_name', label: 'Client Name', value: 'John Doe', included: true },
    { field: 'date_of_loss', label: 'Date of Loss', value: '2024-01-15', included: true },
    { field: 'policy_number', label: 'Policy Number', value: 'POL-12345', included: false },
  ];

  function getApprovedField(fieldKey: string): { value: string } | { error: string } {
    const field = approvedContext.find(c => c.field === fieldKey && c.included);
    if (!field) {
      return { error: `Field "${fieldKey}" is not in the approved context for this mission.` };
    }
    return { value: field.missionSpecificValue || field.value };
  }

  it('returns approved field value', () => {
    const result = getApprovedField('client_full_name');
    expect(result).toEqual({ value: 'John Doe' });
  });

  it('returns approved date field', () => {
    const result = getApprovedField('date_of_loss');
    expect(result).toEqual({ value: '2024-01-15' });
  });

  it('rejects excluded field', () => {
    const result = getApprovedField('policy_number');
    expect(result).toHaveProperty('error');
  });

  it('rejects nonexistent field', () => {
    const result = getApprovedField('social_security_number');
    expect(result).toHaveProperty('error');
  });
});
