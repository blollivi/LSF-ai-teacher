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

    def as_message(self) -> dict:
        msg: dict = {"role": "assistant", "content": self.content}
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
        r = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tools,
            tool_choice="required",
            parallel_tool_calls=False,
            reasoning_effort="medium",
        )
        msg = r.choices[0].message
        calls = [
            ToolCall(id=c.id, name=c.function.name, arguments=json.loads(c.function.arguments or "{}"))
            for c in msg.tool_calls or []
            if c.type == "function"
        ]
        return AssistantTurn(content=msg.content, tool_calls=calls)
