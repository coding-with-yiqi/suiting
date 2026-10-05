"""Streaming community-post candidates through the live analyst loop."""

import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.agents.consolidated_analyst import (
    ConsolidatedAnalystAgent,
    ConsolidatedAnalystOutput,
)
from app.services.agents.orchestrator import AgentOrchestrator


class _Session:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.executed = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1

    async def execute(self, statement):
        self.executed.append(statement)

    async def refresh(self, item):
        if item.created_at is None:
            item.created_at = datetime.now(timezone.utc)


def _orchestrator(websocket):
    with patch(
        "app.services.agents.orchestrator.GeminiLiveSession",
        return_value=AsyncMock(),
    ):
        return AgentOrchestrator(
            session_id=uuid4(),
            websocket=websocket,
            directives=[],
            doc_summaries="",
            active_questions=[],
            speakers=[],
            agent_configs={},
        )


class MultiCandidateTests(unittest.IsolatedAsyncioTestCase):
    async def test_structured_analyst_keeps_all_items(self):
        output = ConsolidatedAnalystOutput(
            items=[
                {"item_type": "community_post", "question": "第一条候选"},
                {"item_type": "community_post", "question": "第二条候选"},
                {"item_type": "community_post", "question": "第三条候选"},
            ]
        )
        agent = ConsolidatedAnalystAgent(
            enabled_types={"community_post"},
            prompt_override="{transcript_window}",
            meeting_context_text="",
        )

        with patch(
            "app.services.agents.consolidated_analyst.generate_json",
            new=AsyncMock(return_value=output),
        ):
            items = await agent.run_cycle("直播正在进行", [], "", [])

        self.assertEqual(
            ["第一条候选", "第二条候选", "第三条候选"],
            [item["question"] for item in items],
        )

    async def test_live_loop_persists_and_streams_candidates_over_multiple_cycles(self):
        websocket = AsyncMock()
        db = _Session()
        orchestrator = _orchestrator(websocket)
        orchestrator._get_interval = MagicMock(return_value=0)
        windows = iter(("第一段", "第二段", "第三段"))
        orchestrator.transcript_buffer.get_window = AsyncMock(
            side_effect=lambda **_: next(windows)
        )
        first = [
            {"item_type": "community_post", "question": "第一条", "source_context": "原文一"},
            {"item_type": "community_post", "question": "第二条", "source_context": "原文二"},
        ]
        second = []
        third = [
            {"item_type": "community_post", "question": "第三条", "source_context": "原文三"},
            {"item_type": "community_post", "question": "第四条", "source_context": "原文四"},
        ]
        outputs = iter((first, second, third))
        seen_board_notes = []

        async def run_cycle(**kwargs):
            seen_board_notes.append(list(kwargs["board_notes"]))
            result = next(outputs)
            if len(seen_board_notes) == 3:
                orchestrator._stopped = True
            return result

        orchestrator.consolidated_agent = MagicMock(
            enabled_types={"community_post"},
            run_cycle=AsyncMock(side_effect=run_cycle),
            last_outcome={"kind": "insights", "items": 2},
        )

        with patch(
            "app.services.agents.orchestrator.async_session",
            return_value=db,
        ):
            task = asyncio.create_task(orchestrator._consolidated_agent_loop())
            await asyncio.wait_for(task, timeout=1)

        self.assertEqual(
            ["第一条", "第二条", "第三条", "第四条"],
            [item.question for item in db.added],
        )
        self.assertEqual(4, db.commits)
        question_messages = [
            call.args[0]
            for call in websocket.send_json.await_args_list
            if call.args[0].get("type") == "question"
        ]
        self.assertEqual(4, len(question_messages))
        self.assertEqual(
            ["第一条", "第二条", "第三条", "第四条"],
            [message["data"]["question"] for message in question_messages],
        )
        self.assertEqual([], seen_board_notes[0])
        self.assertEqual(
            ["第一条", "第二条"],
            [row["text"] for row in seen_board_notes[1]],
        )
        self.assertEqual(
            ["第一条", "第二条"],
            [row["text"] for row in seen_board_notes[2]],
        )

    async def test_new_post_consumes_ignored_fragments_once(self):
        websocket = AsyncMock()
        db = _Session()
        orchestrator = _orchestrator(websocket)
        old_id = str(uuid4())
        orchestrator._deferred_posts = [{"id": old_id, "text": "旧的群文案"}]
        with patch(
            "app.services.agents.orchestrator.async_session",
            return_value=db,
        ):
            saved = await orchestrator._save_and_send_insight(
                {"item_type": "community_post", "question": "合并后的新文案"},
                agent_source="consolidated_analyst",
            )
        self.assertTrue(saved)
        self.assertEqual([], orchestrator._deferred_posts)
        self.assertIn("delivery_state", str(db.executed[0]))


if __name__ == "__main__":
    unittest.main()
