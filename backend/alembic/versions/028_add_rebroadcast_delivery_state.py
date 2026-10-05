"""Track ignored and sent community-post candidates.

Revision ID: 028_add_rebroadcast_delivery_state
Revises: 027_transcript_refinement
Create Date: 2026-10-05
"""

import sqlalchemy as sa

from alembic import op

revision = "028_add_rebroadcast_delivery_state"
down_revision = "027_transcript_refinement"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "questions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("questions")}
    if "delivery_state" not in columns:
        op.add_column(
            "questions",
            sa.Column("delivery_state", sa.String(20), nullable=False, server_default="pending"),
        )


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if "questions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("questions")}
    if "delivery_state" in columns:
        op.drop_column("questions", "delivery_state")
