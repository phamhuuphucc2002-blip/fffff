// Arcanum Collaboration V1 — isolated route module specification
// This module is intentionally standalone so it can be wired into server.js
// without replacing the existing production server in one risky edit.

export const CONTRIBUTOR_COLORS = [
  '#4F8EF7', '#8B5CF6', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#EC4899', '#84CC16'
];

export function contributorColor(index = 0) {
  return CONTRIBUTOR_COLORS[Math.abs(Number(index)) % CONTRIBUTOR_COLORS.length];
}

export function makeContribution({ id, authorId, authorName, color, type = 'suggestion', text }) {
  if (!authorId || !String(text || '').trim()) throw new Error('Contribution requires author and text');
  return {
    id,
    authorId,
    authorName: String(authorName || 'Member').slice(0, 100),
    color: color || contributorColor(0),
    type,
    status: 'pending',
    text: String(text).trim(),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null
  };
}

export function resolveContribution(contribution, { approved, resolverId }) {
  return {
    ...contribution,
    status: approved ? 'approved' : 'rejected',
    resolvedAt: new Date().toISOString(),
    resolvedBy: resolverId
  };
}

export function nextRevision(current = 0) {
  return Number(current || 0) + 1;
}
