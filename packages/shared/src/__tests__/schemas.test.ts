import { describe, it, expect } from 'vitest';
import { createCallMissionSchema, destinationSchema } from '../schemas/call-mission.js';
import { structuredResultSchema } from '../schemas/call-results.js';

describe('destinationSchema', () => {
  it('validates a valid destination', () => {
    const result = destinationSchema.safeParse({
      organizationName: 'State Farm Insurance',
      department: 'Claims',
      phoneNumber: '+18005551234',
      destinationTimezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing organization name', () => {
    const result = destinationSchema.safeParse({
      phoneNumber: '+18005551234',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short phone number', () => {
    const result = destinationSchema.safeParse({
      organizationName: 'State Farm',
      phoneNumber: '123',
    });
    expect(result.success).toBe(false);
  });
});

describe('createCallMissionSchema', () => {
  it('validates a complete mission creation payload', () => {
    const result = createCallMissionSchema.safeParse({
      caseId: '550e8400-e29b-41d4-a716-446655440000',
      missionType: 'open_insurance_claim',
      title: 'Open Claim - State Farm',
      destination: {
        organizationName: 'State Farm Insurance',
        phoneNumber: '+18005551234',
        destinationTimezone: 'America/Chicago',
      },
      approvedContext: [
        {
          field: 'client_full_name',
          label: 'Client Full Name',
          value: 'John Doe',
          included: true,
        },
      ],
      instructions: {
        goal: 'Open a new bodily-injury insurance claim',
        objectives: ['Obtain claim number'],
        successCriteria: ['Claim number obtained'],
        requiredInformation: ['Claim number'],
        allowedDisclosures: ['Client name'],
        restrictedTopics: ['Settlement value'],
        escalationConditions: ['Attorney requested'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mission type', () => {
    const result = createCallMissionSchema.safeParse({
      caseId: '550e8400-e29b-41d4-a716-446655440000',
      missionType: 'negotiate_settlement',
      title: 'Bad Mission',
      destination: {
        organizationName: 'Test',
        phoneNumber: '+18005551234',
      },
      approvedContext: [],
      instructions: {
        goal: 'Test',
        objectives: [],
        successCriteria: [],
        requiredInformation: [],
        allowedDisclosures: [],
        restrictedTopics: [],
        escalationConditions: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('structuredResultSchema', () => {
  it('validates a complete result', () => {
    const result = structuredResultSchema.safeParse({
      missionOutcome: 'success',
      claimOpened: true,
      existingClaimLocated: false,
      claimNumber: 'CLM-2024-123456',
      representativeName: 'Jane Smith',
      representativeDepartment: 'Claims',
      adjusterName: 'Bob Johnson',
      adjusterPhone: '+15551234567',
      adjusterEmail: 'bjohnson@statefarm.com',
      carrierFax: null,
      carrierMailingAddress: null,
      requestedDocuments: [
        {
          documentName: 'Police Report',
          deliveryMethod: 'fax',
          destination: '+15559876543',
          deadline: '2024-02-01',
        },
      ],
      missingInformation: [],
      commitments: ['Adjuster will call within 48 hours'],
      deadlines: [{ description: 'Submit police report', date: '2024-02-01' }],
      nextAction: 'Send police report via fax',
      suggestedFollowUpDate: '2024-02-03',
      escalationReason: null,
      summary: 'Successfully opened claim CLM-2024-123456 with State Farm.',
      confidence: { claimNumber: 0.95, adjusterName: 0.9 },
      evidence: { claimNumber: ['seg-001', 'seg-002'] },
    });
    expect(result.success).toBe(true);
  });
});
