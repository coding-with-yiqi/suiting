import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.routers.questions import _all_delivery_receipts_confirmed, update_question
from app.schemas import QuestionUpdate


class RebroadcastDeliveryTests(unittest.TestCase):
    def test_all_selected_groups_must_confirm_before_candidate_is_sent(self):
        self.assertTrue(
            _all_delivery_receipts_confirmed(
                {
                    "a@chatroom": {"state": "sent"},
                    "b@chatroom": {"state": "sent"},
                }
            )
        )

    def test_partial_or_unknown_delivery_stays_available_for_review(self):
        self.assertFalse(
            _all_delivery_receipts_confirmed(
                {
                    "a@chatroom": {"state": "sent"},
                    "b@chatroom": {"state": "failed"},
                }
            )
        )
        self.assertFalse(_all_delivery_receipts_confirmed({}))


class IgnoreStateTests(unittest.IsolatedAsyncioTestCase):
    async def test_ignoring_a_community_post_moves_it_into_the_live_merge_queue(self):
        session_id = uuid4()
        question_id = uuid4()
        question = SimpleNamespace(
            id=question_id,
            session_id=session_id,
            item_type="community_post",
            question="旧的群文案",
            dismissed=False,
            delivery_state="pending",
        )
        db = SimpleNamespace(
            get=AsyncMock(return_value=question),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        orchestrator = SimpleNamespace(
            defer_community_post=lambda item_id, text: setattr(
                orchestrator, "deferred", (item_id, text)
            ),
            forget_deferred_post=lambda *_args: None,
        )
        with patch(
            "app.routers.questions.get_live_orchestrator",
            return_value=orchestrator,
        ):
            await update_question(
                session_id,
                question_id,
                QuestionUpdate(dismissed=True),
                db,
            )
        self.assertTrue(question.dismissed)
        self.assertEqual("ignored", question.delivery_state)
        self.assertEqual((str(question_id), "旧的群文案"), orchestrator.deferred)

    async def test_dismissing_a_sent_post_does_not_requeue_it(self):
        session_id = uuid4()
        question_id = uuid4()
        question = SimpleNamespace(
            id=question_id,
            session_id=session_id,
            item_type="community_post",
            question="已发送的文案",
            dismissed=False,
            delivery_state="sent",
        )
        db = SimpleNamespace(
            get=AsyncMock(return_value=question),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        orchestrator = SimpleNamespace(
            defer_community_post=MagicMock(),
            forget_deferred_post=MagicMock(),
        )
        with patch(
            "app.routers.questions.get_live_orchestrator",
            return_value=orchestrator,
        ):
            await update_question(
                session_id,
                question_id,
                QuestionUpdate(dismissed=True),
                db,
            )
        self.assertEqual("sent", question.delivery_state)
        orchestrator.defer_community_post.assert_not_called()
        orchestrator.forget_deferred_post.assert_called_once()


if __name__ == "__main__":
    unittest.main()
