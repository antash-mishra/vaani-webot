#
# Copyright (c) 2024–2025, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""OpenAI Bot Implementation.

This module implements a chatbot using OpenAI's GPT-4 model for natural language
processing. It includes:
- Real-time audio/video interaction through Daily
- Animated robot avatar
- Text-to-speech using ElevenLabs
- Support for both English and Spanish

The bot runs as part of a pipeline that processes audio/video frames and manages
the conversation flow.
"""

import argparse
import asyncio
import os
import sys

import aiohttp
from dotenv import load_dotenv
from loguru import logger
from PIL import Image
from pathlib import Path

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    OutputImageRawFrame,
    SpriteFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.frames.frames import Frame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIConfig, RTVIObserver, RTVIProcessor
from pipecat.services.elevenlabs import ElevenLabsTTSService
from pipecat.services.azure import AzureSTTService
from pipecat.transcriptions.language import Language
from pipecat.services.openai import BaseOpenAILLMService
from pipecat.services.cerebras import CerebrasLLMService
from pipecat.transports.services.daily import DailyParams, DailyTransport

load_dotenv(override=True)
logger.remove(0)
logger.add(sys.stderr, level="DEBUG")

class TranscriptionLogger(FrameProcessor):
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            print(f"Transcription: {frame.text}")


async def main(room_url: str, token: str):
    """Main bot execution function.

    Sets up and runs the bot pipeline including:
    - Daily video transport
    - Speech-to-text and text-to-speech services
    - Language model integration
    - Animation processing
    - RTVI event handling
    """
        # Set up Daily transport with video/audio parameters
    transport = DailyTransport(
        room_url=room_url,
        token=token,
        bot_name="Chatbot",
        params=DailyParams(
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
            vad_audio_passthrough=True,
            # transcription_settings=DailyTranscriptionSettings(
            #     language="hi",
            #     model="nova-2-general",
            # ),
        ),
    )
    
    stt = AzureSTTService(
        api_key=os.getenv("AZURE_SPEECH_API_KEY", ""),
        region=os.getenv("AZURE_SPEECH_REGION", "centralindia"),
        language=Language("hi-IN"),
        sample_rate=16000,
        channels=1
    )
    
    # tl = TranscriptionLogger()
    # print("STT: ", stt.can_generate_metrics)

    # Initialize text-to-speech service
    tts = ElevenLabsTTSService(
        api_key=os.getenv("ELEVENLABS_API_KEY", ""),
        #
        # English
        #
        model="eleven_flash_v2_5",
        voice_id=os.getenv("ELEVENLABS_VOICE_ID", ""),
        params=ElevenLabsTTSService.InputParams(
            stability=0.7,
            similarity_boost=0.8,
            style=0.5,
            use_speaker_boost=False
        )
    )

    # Initialize LLM service
    # llm = OpenAILLMService(
    #     api_key=os.getenv("OPENAI_API_KEY"), 
    #     model="gpt-4o-mini", 
    #     input_params=BaseOpenAILLMService.InputParams(
    #         temperature=0.7,
    #         max_tokens=800,
    #         top_p=1,
    #         frequency_penalty=0,
    #         presence_penalty=0
    #     )
    # )
    
    llm = CerebrasLLMService(
        api_key=os.getenv("CEREBRAS_API_KEY", ""),
        model="llama-3.3-70b",
        params=BaseOpenAILLMService.InputParams(
            temperature=0.7,
            max_completion_tokens=250,  # Set your desired max token limit here
            top_p=1.0,
        )
    )


    messages = [
        {
            "role": "system",
            "content": Path("prompt.txt").read_text(),
        },
    ]

    
    # Set up conversation context and management
    # The context_aggregator will automatically collect conversation context
    context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(context)
    #
    # RTVI events for Pipecat client UI
    #
    rtvi = RTVIProcessor(config=RTVIConfig(config=[]))

    pipeline = Pipeline(
        [
            transport.input(),
            rtvi,
            stt,

            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
            report_only_initial_ttfb=True,
    
        ),
        observers=[RTVIObserver(rtvi)],
    )

    @rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        await rtvi.set_bot_ready()

    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        await transport.capture_participant_transcription(participant["id"])
        await task.queue_frames([context_aggregator.user().get_context_frame()])

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        print(f"Participant left: {participant}")
        await task.cancel()

    runner = PipelineRunner()

    await runner.run(task)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pipecat Bot")
    parser.add_argument("-u", type=str, help="Room URL")
    parser.add_argument("-t", type=str, help="Token")
    config = parser.parse_args()

    asyncio.run(main(config.u, config.t))