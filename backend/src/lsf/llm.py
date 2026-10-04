import json
from dataclasses import dataclass, field
from typing import Protocol

from openai import AsyncOpenAI


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class AssistantTurn:
    content: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)
    # Raw Responses API output items (incl. reasoning), replayed verbatim on the next turn.
    raw_items: list[dict] | None = None

    def as_message(self) -> dict:
        msg: dict = {"role": "assistant", "content": self.content}
        if self.raw_items is not None:
            msg["_raw_items"] = self.raw_items
        if self.tool_calls:
            msg["tool_calls"] = [
                {
                    "id": c.id,
                    "type": "function",
                    "function": {"name": c.name, "arguments": json.dumps(c.arguments, ensure_ascii=False)},
                }
                for c in self.tool_calls
            ]
        return msg


class LLM(Protocol):
    async def json(self, system: str, user: str, schema_name: str, schema: dict) -> dict: ...

    async def tools(self, messages: list[dict], tools: list[dict]) -> AssistantTurn: ...


def function_tool(name: str, description: str, properties: dict) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": list(properties),
                "additionalProperties": False,
            },
        },
    }


class OpenAILLM:
    def __init__(self, api_key: str, model: str):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model

    async def json(self, system: str, user: str, schema_name: str, schema: dict) -> dict:
        r = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            reasoning_effort="medium",
        )
        return json.loads(r.choices[0].message.content or "{}")

    async def tools(self, messages: list[dict], tools: list[dict]) -> AssistantTurn:
        # Responses API: Chat Completions rejects function tools combined with a reasoning effort on gpt-5.x.
        r = await self.client.responses.create(
            model=self.model,
            input=_to_responses_input(messages),
            tools=[{"type": "function", **t["function"]} for t in tools],
            tool_choice="required",
            parallel_tool_calls=False,
            reasoning={"effort": "medium"},
        )
        calls = [
            ToolCall(id=item.call_id, name=item.name, arguments=json.loads(item.arguments or "{}"))
            for item in r.output
            if item.type == "function_call"
        ]
        return AssistantTurn(
            content=r.output_text or None,
            tool_calls=calls,
            raw_items=[item.model_dump(exclude_none=True) for item in r.output],
        )


def _to_responses_input(messages: list[dict]) -> list[dict]:
    """Chat-style history -> Responses API input items. Assistant turns produced by `tools`
    are replayed from their raw items so reasoning carries over between tool calls."""
    items: list[dict] = []
    for m in messages:
        if m["role"] == "tool":
            items.append({"type": "function_call_output", "call_id": m["tool_call_id"], "output": m["content"]})
        elif m["role"] == "assistant" and "_raw_items" in m:
            items.extend(m["_raw_items"])
        elif m["role"] == "assistant":
            if m.get("content"):
                items.append({"role": "assistant", "content": m["content"]})
            for c in m.get("tool_calls", []):
                f = c["function"]
                items.append({"type": "function_call", "call_id": c["id"], "name": f["name"], "arguments": f["arguments"]})
        else:
            items.append({"role": m["role"], "content": m["content"]})
    return items
