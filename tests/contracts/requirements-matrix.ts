export type RequirementPriority = 'P0' | 'P1' | 'P2'

export type RequirementCoverageEntry = {
  id: string
  feature: string
  userValue: string
  risk: string
  priority: RequirementPriority
  tests: ReadonlyArray<string>
}

export const REQUIREMENTS_MATRIX: ReadonlyArray<RequirementCoverageEntry> = [
  {
    id: 'REQ-ASSETHUB-CHARACTER-EDIT',
    feature: 'Asset Hub character edit',
    userValue: 'Character edit visible and saved correctly',
    risk: 'Field mapping drift causes save failure or wrong write',
    priority: 'P0',
    tests: [
      'tests/integration/api/contract/crud-routes.test.ts',
      'tests/integration/chain/text.chain.test.ts',
    ],
  },
  {
    id: 'REQ-ASSETHUB-REFERENCE-TO-CHARACTER',
    feature: 'Asset Hub reference-to-character',
    userValue: 'Generate character from reference image and use it',
    risk: 'referenceImages lost or wrong branch',
    priority: 'P0',
    tests: [
      'tests/unit/helpers/reference-to-character-helpers.test.ts',
      'tests/unit/worker/reference-to-character.test.ts',
      'tests/integration/chain/text.chain.test.ts',
    ],
  },
  {
    id: 'REQ-NP-GENERATE-IMAGE',
    feature: 'Novel promotion image generation',
    userValue: 'Character/location/panel images generated and written back',
    risk: 'Task payload drift, worker writes wrong entity',
    priority: 'P0',
    tests: [
      'tests/integration/api/contract/direct-submit-routes.test.ts',
      'tests/unit/worker/image-task-handlers-core.test.ts',
      'tests/integration/chain/image.chain.test.ts',
    ],
  },
  {
    id: 'REQ-NP-GENERATE-VIDEO',
    feature: 'Novel promotion video generation',
    userValue: 'Panel video generated and state tracked',
    risk: 'Wrong panel, wrong model capability, state mismatch',
    priority: 'P0',
    tests: [
      'tests/integration/api/contract/direct-submit-routes.test.ts',
      'tests/unit/worker/video-worker.test.ts',
      'tests/integration/chain/video.chain.test.ts',
    ],
  },
  {
    id: 'REQ-NP-TEXT-ANALYSIS',
    feature: 'Text analysis and storyboard orchestration',
    userValue: 'Text analysis pipeline stable and replayable',
    risk: 'Step orchestration change breaks result structure',
    priority: 'P1',
    tests: [
      'tests/integration/api/contract/llm-observe-routes.test.ts',
      'tests/unit/worker/script-to-storyboard.test.ts',
      'tests/integration/chain/text.chain.test.ts',
    ],
  },
  {
    id: 'REQ-TASK-STATE-CONSISTENCY',
    feature: 'Task state and SSE consistency',
    userValue: 'Frontend state matches task state',
    risk: 'target-state vs SSE mismatch causes wrong toast',
    priority: 'P0',
    tests: [
      'tests/unit/helpers/task-state-service.test.ts',
      'tests/integration/api/contract/task-infra-routes.test.ts',
      'tests/unit/optimistic/sse-invalidation.test.ts',
    ],
  },
]
