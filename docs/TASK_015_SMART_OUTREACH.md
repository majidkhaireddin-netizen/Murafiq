# Task 015: Smart Outreach & Communication Composer Documentation
# مشروع مُرافق — Murafiq

## Overview
Task 015 implements the Smart Outreach & Communication Composer module for Murafiq (`مُرافق`), providing professional message composition, variable interpolation with anti-fabrication safeguards, custom template lifecycle management, secure Gemini AI drafting (`POST /api/ai/communication-draft`), and strict human-in-the-loop dispatch and manual interaction logging.

## Core Capabilities & Architecture

1. **Unified Context-Aware Composer (`CommunicationComposerModal.tsx`)**:
   - Integrated across 5 major workspaces: CommunicationsView, Client360Workspace (ClientsView), OpportunityDetailWorkspace, TodayView, and PlaybookRunWorkspace.
   - Preserves active context (`clientId`, `contactId`, `opportunityId`, `meetingId`, `channel`) with server-side ownership verification.

2. **Secure Server-Side AI Drafting & Authorization (`aiRouter.ts`, `communicationAiService.ts`)**:
   - Enforces Firebase Bearer token authentication via `verifyFirebaseBearerToken`.
   - Validates client and related entity ownership inside the named Firestore DB (`ai-studio-murafiq-cb988db3-5a07-40b7-b1ca-8eaaae894475`).
   - Rejects token/uid spoofing, prevents disallowed input/B2 attachment fields, enforces sliding-window rate limiting, and supports `AbortController`.
   - Uses model `'gemini-4-hydrogen'` with structured JSON response schemas and strict system instructions.

3. **Explicit Gemini Privacy & Consent Modal**:
   - Dedicated disclosure UI requiring explicit user consent before sending context data to Gemini. Discloses exact field names shared, draft-only purpose, human review requirement, and no auto-send guarantee.

4. **Template Lifecycle & Anti-Fabrication Engine (`communicationComposerEngine.ts`)**:
   - Supports system template cloning, custom template CRUD, and system template protection.
   - Strictly forbids fabricating dues, dates, or unregistered names. Missing variables are clearly flagged in `missingVariables` and reported via warning banners with manual completion support.

5. **Human-in-the-Loop Dispatch & Honest Logging**:
   - Copying or opening external links (`wa.me`/`mailto:`) never auto-logs. Requires explicit user confirmation checkbox confirming communication actually occurred before saving to `interactions`.
