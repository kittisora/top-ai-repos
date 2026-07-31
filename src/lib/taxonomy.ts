/**
 * The category taxonomy.
 *
 * Two levels: a small set of GROUPS (the broad shape of the ecosystem) and a
 * flat list of CATEGORIES beneath them. Deliberately flat below the group
 * level — deep trees look tidy and then every real repo lands in the wrong
 * leaf. Repos get one primary category and any number of secondary ones.
 *
 * This module is pure data + pure functions. It has no imports and no I/O so
 * it can be used from the ingestion workers, the API and the UI alike.
 *
 * `topics` are GitHub topic slugs that strongly imply the category — they are
 * the highest-signal evidence we have. `keywords` are matched against the repo
 * name, description and README with word boundaries (see scoreCategories).
 */

export type GroupSlug =
  | 'infrastructure'
  | 'model-development'
  | 'application-development';

export interface Group {
  slug: GroupSlug;
  name: string;
  description: string;
}

export interface Category {
  slug: string;
  name: string;
  group: GroupSlug;
  description: string;
  /** GitHub topic slugs that strongly imply this category. */
  topics: string[];
  /** Phrases matched against name/description/README, word-boundary aware. */
  keywords: string[];
}

export const GROUPS: Group[] = [
  {
    slug: 'infrastructure',
    name: 'Infrastructure',
    description:
      'The plumbing that runs models in production: serving, storage, orchestration, observability and data movement.',
  },
  {
    slug: 'model-development',
    name: 'Model Development',
    description:
      'Building the models themselves: training, fine-tuning, evaluation, and the modality-specific research stacks.',
  },
  {
    slug: 'application-development',
    name: 'Application Development',
    description:
      'What people build on top of models: agents, retrieval, developer tools, interfaces and end-user products.',
  },
];

export const CATEGORIES: Category[] = [
  // ---------------------------------------------------------------- infra --
  {
    slug: 'inference-serving',
    name: 'Inference & Serving',
    group: 'infrastructure',
    description:
      'Runtimes and servers that execute model inference at speed and scale.',
    topics: [
      'llm-inference',
      'inference',
      'inference-engine',
      'model-serving',
      'llm-serving',
      'llama-cpp',
      'vllm',
      'triton-inference-server',
      'tensorrt',
      'onnx',
      'onnxruntime',
      'llamacpp',
      'text-generation-inference',
    ],
    keywords: [
      'inference engine',
      'inference server',
      'serving engine',
      'model serving',
      'serve llms',
      'high-throughput',
      'kv cache',
      'paged attention',
      'continuous batching',
      'speculative decoding',
      'tensor parallelism',
      'run llms locally',
      'local llm',
      'openai-compatible api',
      'openai compatible server',
    ],
  },
  {
    slug: 'model-optimization',
    name: 'Model Optimization',
    group: 'infrastructure',
    description:
      'Making models smaller and faster: quantization, distillation, pruning, sparsity and kernel-level work.',
    topics: [
      'quantization',
      'model-compression',
      'pruning',
      'knowledge-distillation',
      'gptq',
      'awq',
      'bitsandbytes',
      'sparsity',
      'cuda-kernels',
      'triton-lang',
      'flash-attention',
    ],
    keywords: [
      'quantization',
      'quantized',
      'int8',
      'int4',
      'fp8',
      '4-bit',
      '8-bit',
      'model compression',
      'knowledge distillation',
      'pruning',
      'sparsity',
      'cuda kernel',
      'fused kernel',
      'flash attention',
      'memory footprint',
    ],
  },
  {
    slug: 'vector-databases',
    name: 'Vector Databases & Search',
    group: 'infrastructure',
    description:
      'Storage and retrieval for embeddings: vector indexes, hybrid search and ANN libraries.',
    topics: [
      'vector-database',
      'vector-search',
      'vector-store',
      'similarity-search',
      'approximate-nearest-neighbor',
      'ann-search',
      'faiss',
      'hnsw',
      'semantic-search',
      'nearest-neighbor-search',
    ],
    keywords: [
      'vector database',
      'vector store',
      'vector index',
      'vector search',
      'similarity search',
      'nearest neighbor',
      'nearest neighbour',
      'hnsw',
      'ivf',
      'hybrid search',
      'billion-scale',
      'embedding storage',
    ],
  },
  {
    slug: 'mlops',
    name: 'MLOps & Pipelines',
    group: 'infrastructure',
    description:
      'Experiment tracking, model registries, feature stores, workflow schedulers and deployment tooling.',
    topics: [
      'mlops',
      'machine-learning-operations',
      'experiment-tracking',
      'model-registry',
      'feature-store',
      'ml-platform',
      'kubeflow',
      'mlflow',
      'model-deployment',
      'llmops',
    ],
    keywords: [
      'mlops',
      'llmops',
      'experiment tracking',
      'model registry',
      'feature store',
      'ml pipeline',
      'training pipeline',
      'reproducible',
      'model deployment',
      'ml platform',
      'ml lifecycle',
    ],
  },
  {
    slug: 'observability',
    name: 'Observability & Tracing',
    group: 'infrastructure',
    description:
      'Logging, tracing, cost tracking and production monitoring for LLM and ML systems.',
    topics: [
      'llm-observability',
      'observability',
      'tracing',
      'monitoring',
      'llm-monitoring',
      'ml-monitoring',
      'telemetry',
      'opentelemetry',
      'drift-detection',
    ],
    keywords: [
      'observability',
      'llm tracing',
      'trace llm',
      'monitor llm',
      'production monitoring',
      'drift detection',
      'token usage',
      'cost tracking',
      'latency tracking',
      'debug llm',
      'prompt logging',
    ],
  },
  {
    slug: 'gateways-proxies',
    name: 'Gateways & Routing',
    group: 'infrastructure',
    description:
      'Unified APIs, model routers, proxies, caching layers and rate limiting across providers.',
    topics: [
      'llm-gateway',
      'ai-gateway',
      'api-gateway',
      'llm-proxy',
      'model-router',
      'load-balancing',
    ],
    keywords: [
      'llm gateway',
      'ai gateway',
      'unified api',
      'unified interface',
      'model router',
      'route requests',
      'proxy for llm',
      'multi-provider',
      'fallback',
      'semantic cache',
      'rate limiting',
      'drop-in replacement for openai',
    ],
  },
  {
    slug: 'data-processing',
    name: 'Data Processing & Labeling',
    group: 'infrastructure',
    description:
      'ETL, document parsing, web crawling, synthetic data generation, annotation and dataset curation tooling.',
    topics: [
      'data-engineering',
      'etl',
      'data-pipeline',
      'web-scraping',
      'crawler',
      'data-labeling',
      'annotation-tool',
      'synthetic-data',
      'data-augmentation',
      'ocr',
      'document-parsing',
      'pdf-parser',
    ],
    keywords: [
      'data pipeline',
      'etl',
      'web crawler',
      'web scraping',
      'scrape',
      'document parsing',
      'pdf extraction',
      'parse pdf',
      'ocr',
      'data labeling',
      'data labelling',
      'annotation tool',
      'synthetic data',
      'data augmentation',
      'data curation',
      'chunking',
      'markdown conversion',
    ],
  },
  {
    slug: 'gpu-compute',
    name: 'GPU & Distributed Compute',
    group: 'infrastructure',
    description:
      'Cluster scheduling, GPU sharing, serverless compute and the distributed execution layer.',
    topics: [
      'gpu',
      'cuda',
      'distributed-computing',
      'kubernetes',
      'ray',
      'slurm',
      'serverless',
      'hpc',
      'gpu-cluster',
    ],
    keywords: [
      'gpu cluster',
      'gpu scheduling',
      'distributed computing',
      'distributed execution',
      'cluster manager',
      'job scheduler',
      'serverless gpu',
      'multi-node',
      'compute orchestration',
    ],
  },

  // ------------------------------------------------------ model development --
  {
    slug: 'training-frameworks',
    name: 'Training Frameworks',
    group: 'model-development',
    description:
      'Core deep-learning frameworks and libraries for pretraining and distributed training.',
    topics: [
      'deep-learning',
      'neural-network',
      'pytorch',
      'tensorflow',
      'jax',
      'distributed-training',
      'training',
      'deepspeed',
      'megatron',
      'pretraining',
    ],
    keywords: [
      'deep learning framework',
      'training framework',
      'distributed training',
      'pretraining',
      'pre-training',
      'train from scratch',
      'autograd',
      'automatic differentiation',
      'data parallel',
      'pipeline parallel',
      'zero redundancy',
      'from scratch implementation',
    ],
  },
  {
    slug: 'fine-tuning',
    name: 'Fine-tuning & Alignment',
    group: 'model-development',
    description:
      'Adapting pretrained models: PEFT/LoRA, instruction tuning, RLHF, DPO and preference alignment.',
    topics: [
      'fine-tuning',
      'finetuning',
      'lora',
      'peft',
      'qlora',
      'rlhf',
      'dpo',
      'instruction-tuning',
      'alignment',
      'sft',
    ],
    keywords: [
      'fine-tuning',
      'fine tuning',
      'finetune',
      'lora',
      'qlora',
      'peft',
      'parameter-efficient',
      'adapter',
      'rlhf',
      'dpo',
      'grpo',
      'ppo',
      'instruction tuning',
      'supervised fine-tuning',
      'preference optimization',
      'alignment',
    ],
  },
  {
    slug: 'foundation-models',
    name: 'Foundation Models',
    group: 'model-development',
    description:
      'Released model weights, reference implementations and architecture research.',
    topics: [
      'large-language-models',
      'llm',
      'foundation-models',
      'transformer',
      'gpt',
      'llama',
      'mistral',
      'qwen',
      'language-model',
      'moe',
      'state-space-model',
    ],
    keywords: [
      'model weights',
      'open weights',
      'reference implementation',
      'model release',
      'pretrained model',
      'transformer architecture',
      'mixture of experts',
      'state space model',
      'technical report',
      'model card',
      'billion parameter',
    ],
  },
  {
    slug: 'computer-vision',
    name: 'Computer Vision',
    group: 'model-development',
    description:
      'Detection, segmentation, tracking, OCR models, 3D reconstruction and classical vision.',
    topics: [
      'computer-vision',
      'object-detection',
      'image-segmentation',
      'yolo',
      'opencv',
      'image-classification',
      'pose-estimation',
      'object-tracking',
      'nerf',
      'gaussian-splatting',
      '3d-reconstruction',
      'face-recognition',
    ],
    keywords: [
      'computer vision',
      'object detection',
      'image segmentation',
      'semantic segmentation',
      'instance segmentation',
      'pose estimation',
      'object tracking',
      'image classification',
      'face recognition',
      'depth estimation',
      'optical flow',
      'gaussian splatting',
      'neural radiance',
      '3d reconstruction',
    ],
  },
  {
    slug: 'speech-audio',
    name: 'Speech & Audio',
    group: 'model-development',
    description:
      'Speech recognition, text-to-speech, voice cloning, music generation and audio processing.',
    topics: [
      'speech-recognition',
      'text-to-speech',
      'tts',
      'stt',
      'asr',
      'whisper',
      'voice-cloning',
      'speech-synthesis',
      'audio-processing',
      'music-generation',
      'speech-to-text',
      'voice-assistant',
    ],
    keywords: [
      'speech recognition',
      'speech-to-text',
      'text-to-speech',
      'voice cloning',
      'voice synthesis',
      'speech synthesis',
      'transcription',
      'transcribe audio',
      'audio generation',
      'music generation',
      'speaker diarization',
      'voice agent',
      'real-time voice',
    ],
  },
  {
    slug: 'image-generation',
    name: 'Image Generation',
    group: 'model-development',
    description:
      'Diffusion models, image editing, upscaling and the surrounding creative tooling.',
    topics: [
      'stable-diffusion',
      'diffusion-models',
      'image-generation',
      'text-to-image',
      'generative-art',
      'comfyui',
      'controlnet',
      'flux',
      'inpainting',
      'super-resolution',
      'gan',
    ],
    keywords: [
      'text-to-image',
      'image generation',
      'diffusion model',
      'stable diffusion',
      'latent diffusion',
      'inpainting',
      'outpainting',
      'image editing',
      'upscaling',
      'super resolution',
      'generative art',
      'controlnet',
    ],
  },
  {
    slug: 'video-generation',
    name: 'Video & 3D Generation',
    group: 'model-development',
    description:
      'Video synthesis and editing, talking heads, avatars, animation and 3D asset generation.',
    topics: [
      'video-generation',
      'text-to-video',
      'video-editing',
      'animation',
      'talking-head',
      'avatar',
      'deepfake',
      'lip-sync',
      'text-to-3d',
      'motion-generation',
    ],
    keywords: [
      'video generation',
      'text-to-video',
      'image-to-video',
      'video synthesis',
      'video editing',
      'talking head',
      'lip sync',
      'avatar generation',
      'motion generation',
      'text-to-3d',
      '3d generation',
      'face swap',
    ],
  },
  {
    slug: 'multimodal',
    name: 'Multimodal',
    group: 'model-development',
    description:
      'Vision-language models, document understanding and any-to-any architectures.',
    topics: [
      'multimodal',
      'vision-language-model',
      'vlm',
      'clip',
      'multimodal-llm',
      'visual-question-answering',
      'document-understanding',
      'image-captioning',
    ],
    keywords: [
      'multimodal',
      'vision-language',
      'vision language model',
      'image understanding',
      'visual question answering',
      'image captioning',
      'document understanding',
      'any-to-any',
      'cross-modal',
    ],
  },
  {
    slug: 'embeddings',
    name: 'Embeddings & Rerankers',
    group: 'model-development',
    description:
      'Text and multimodal embedding models, rerankers and representation learning.',
    topics: [
      'embeddings',
      'sentence-embeddings',
      'text-embeddings',
      'sentence-transformers',
      'reranking',
      'representation-learning',
      'contrastive-learning',
    ],
    keywords: [
      'embedding model',
      'text embeddings',
      'sentence embeddings',
      'sentence transformer',
      'reranker',
      'reranking',
      'cross-encoder',
      'bi-encoder',
      'representation learning',
      'contrastive learning',
    ],
  },
  {
    slug: 'nlp',
    name: 'NLP & Text Processing',
    group: 'model-development',
    description:
      'Tokenization, parsing, classical NLP pipelines, translation and information extraction.',
    topics: [
      'nlp',
      'natural-language-processing',
      'tokenizer',
      'named-entity-recognition',
      'text-classification',
      'machine-translation',
      'sentiment-analysis',
      'spacy',
      'information-extraction',
    ],
    keywords: [
      'natural language processing',
      'tokenizer',
      'tokenization',
      'named entity recognition',
      'text classification',
      'sentiment analysis',
      'machine translation',
      'part-of-speech',
      'information extraction',
      'text summarization',
    ],
  },
  {
    slug: 'reinforcement-learning',
    name: 'Reinforcement Learning',
    group: 'model-development',
    description:
      'RL algorithms, environments, simulators and decision-making systems.',
    topics: [
      'reinforcement-learning',
      'deep-reinforcement-learning',
      'rl',
      'gymnasium',
      'openai-gym',
      'multi-agent-reinforcement-learning',
      'imitation-learning',
    ],
    keywords: [
      'reinforcement learning',
      'policy gradient',
      'q-learning',
      'actor-critic',
      'rl environment',
      'rl algorithms',
      'imitation learning',
      'reward model',
      'markov decision',
      'self-play',
    ],
  },
  {
    slug: 'evaluation',
    name: 'Evaluation & Benchmarks',
    group: 'model-development',
    description:
      'Benchmarks, leaderboards, LLM-as-judge harnesses, testing and red-teaming.',
    topics: [
      'benchmark',
      'evaluation',
      'llm-evaluation',
      'leaderboard',
      'llm-eval',
      'red-teaming',
      'testing',
      'model-evaluation',
    ],
    keywords: [
      'evaluation framework',
      'evaluation harness',
      'benchmark suite',
      'llm evaluation',
      'llm-as-a-judge',
      'llm as judge',
      'leaderboard',
      'red teaming',
      'red-teaming',
      'test llm',
      'regression testing',
      'hallucination detection',
      'scoring',
    ],
  },
  {
    slug: 'datasets',
    name: 'Datasets',
    group: 'model-development',
    description:
      'Published datasets, dataset tooling and corpora for training and evaluation.',
    topics: ['dataset', 'datasets', 'corpus', 'training-data', 'open-data'],
    keywords: [
      'dataset',
      'datasets',
      'training data',
      'corpus',
      'annotated data',
      'data collection',
      'million examples',
    ],
  },

  // ------------------------------------------------ application development --
  {
    slug: 'agents',
    name: 'Agents & Frameworks',
    group: 'application-development',
    description:
      'Autonomous and multi-agent systems, agent frameworks, planning and tool use.',
    topics: [
      'ai-agent',
      'ai-agents',
      'agents',
      'autonomous-agents',
      'agent-framework',
      'multi-agent',
      'multi-agent-systems',
      'agentic',
      'agentic-ai',
      'agentic-workflow',
      'llm-agent',
      'autogpt',
      'langgraph',
      'crewai',
    ],
    keywords: [
      'ai agent',
      'ai agents',
      'autonomous agent',
      'agent framework',
      'multi-agent',
      'multi agent',
      'agentic',
      'agent orchestration',
      'tool calling',
      'tool use',
      'function calling',
      'task decomposition',
      'planning and execution',
      'reason and act',
      'react agent',
      'ai assistant',
      'personal assistant',
      'personal ai',
      'digital assistant',
    ],
  },
  {
    slug: 'rag',
    name: 'RAG & Knowledge',
    group: 'application-development',
    description:
      'Retrieval-augmented generation, document Q&A, knowledge graphs and memory systems.',
    topics: [
      'rag',
      'retrieval-augmented-generation',
      'llamaindex',
      'knowledge-graph',
      'question-answering',
      'chat-with-documents',
      'graphrag',
      'memory',
      'context-engineering',
    ],
    keywords: [
      'retrieval-augmented generation',
      'retrieval augmented',
      'rag pipeline',
      'rag framework',
      'chat with your documents',
      'chat with pdf',
      'question answering over',
      'knowledge base',
      'knowledge graph',
      'document retrieval',
      'long-term memory',
      'memory layer',
      'context engineering',
    ],
  },
  {
    slug: 'ai-coding',
    name: 'AI Coding & Dev Tools',
    group: 'application-development',
    description:
      'Coding assistants, autonomous software engineers, code review bots and IDE integrations.',
    topics: [
      'ai-coding',
      'code-generation',
      'copilot',
      'coding-assistant',
      'ai-programming',
      'code-review',
      'developer-tools',
      'code-completion',
      'software-engineering-agent',
      'vibe-coding',
    ],
    keywords: [
      'coding assistant',
      'coding agent',
      'code generation',
      'code completion',
      'ai pair programmer',
      'pair programming',
      'software engineer agent',
      'code review',
      'refactoring',
      'ide extension',
      'vscode extension',
      'terminal agent',
      'cli coding',
      'bug fixing',
    ],
  },
  {
    slug: 'mcp-tools',
    name: 'MCP & Integrations',
    group: 'application-development',
    description:
      'Model Context Protocol servers and clients, plugin systems and third-party tool connectors.',
    topics: [
      'mcp',
      'model-context-protocol',
      'mcp-server',
      'mcp-client',
      'function-calling',
      'plugins',
      'integrations',
      'tool-calling',
    ],
    keywords: [
      'model context protocol',
      'mcp server',
      'mcp client',
      'mcp servers',
      'tool integration',
      'plugin system',
      'connector',
      'integrations for',
    ],
  },
  {
    slug: 'prompt-engineering',
    name: 'Prompting & Structured Output',
    group: 'application-development',
    description:
      'Prompt management, templating, DSLs, constrained decoding and guaranteed-schema output.',
    topics: [
      'prompt-engineering',
      'prompt',
      'prompts',
      'structured-output',
      'json-schema',
      'constrained-decoding',
      'dspy',
      'prompt-management',
    ],
    keywords: [
      'prompt engineering',
      'prompt template',
      'prompt management',
      'prompt optimization',
      'structured output',
      'structured generation',
      'constrained decoding',
      'json output',
      'guaranteed json',
      'schema-guided',
      'grammar-based',
      'output parser',
    ],
  },
  {
    slug: 'chat-ui',
    name: 'Chat UIs & Frontends',
    group: 'application-development',
    description:
      'Chat interfaces, desktop clients, playgrounds and UI component libraries for AI apps.',
    topics: [
      'chatbot',
      'chatgpt',
      'chat-ui',
      'webui',
      'gradio',
      'streamlit',
      'chatbot-ui',
      'desktop-app',
      'user-interface',
    ],
    keywords: [
      'chat interface',
      'chat ui',
      'web ui',
      'chatbot',
      'desktop client',
      'playground',
      'frontend for',
      'self-hosted chat',
      'ui components',
      'chat application',
    ],
  },
  {
    slug: 'workflow-automation',
    name: 'Workflow & Automation',
    group: 'application-development',
    description:
      'Visual builders, low-code AI workflows, pipeline orchestration and automation platforms.',
    topics: [
      'workflow',
      'workflow-automation',
      'low-code',
      'no-code',
      'automation',
      'orchestration',
      'flow-based-programming',
      'drag-and-drop',
      'n8n',
    ],
    keywords: [
      'workflow automation',
      'visual builder',
      'drag and drop',
      'low-code',
      'no-code',
      'flow builder',
      'pipeline builder',
      'automation platform',
      'node-based editor',
      'workflow engine',
    ],
  },
  {
    slug: 'browser-automation',
    name: 'Browser & Computer Use',
    group: 'application-development',
    description:
      'Agents that drive browsers, desktops and GUIs, plus web automation and testing.',
    topics: [
      'browser-automation',
      'web-automation',
      'computer-use',
      'gui-agent',
      'playwright',
      'puppeteer',
      'selenium',
      'web-agent',
    ],
    keywords: [
      'browser automation',
      'browser agent',
      'web automation',
      'computer use',
      'gui agent',
      'control your computer',
      'automate the browser',
      'headless browser',
      'screen understanding',
      'ui automation',
    ],
  },
  {
    slug: 'robotics',
    name: 'Robotics & Embodied AI',
    group: 'application-development',
    description:
      'Robot learning, manipulation, autonomous driving, simulation and embodied agents.',
    topics: [
      'robotics',
      'ros',
      'ros2',
      'embodied-ai',
      'autonomous-driving',
      'self-driving-car',
      'manipulation',
      'drone',
      'slam',
      'simulation',
    ],
    keywords: [
      'robotics',
      'robot learning',
      'embodied ai',
      'manipulation',
      'autonomous driving',
      'self-driving',
      'motion planning',
      'slam',
      'robot simulation',
      'vision-language-action',
      'humanoid',
      'drone',
    ],
  },
  {
    slug: 'ai-safety',
    name: 'Safety, Security & Guardrails',
    group: 'application-development',
    description:
      'Guardrails, PII redaction, prompt-injection defense, interpretability and offensive/defensive AI security.',
    topics: [
      'ai-safety',
      'ai-security',
      'guardrails',
      'prompt-injection',
      'jailbreak',
      'llm-security',
      'interpretability',
      'explainable-ai',
      'privacy',
      'content-moderation',
    ],
    keywords: [
      'guardrails',
      'ai safety',
      'llm security',
      'prompt injection',
      'jailbreak',
      'content moderation',
      'pii detection',
      'pii redaction',
      'toxicity',
      'interpretability',
      'explainable',
      'mechanistic interpretability',
      'adversarial attack',
      'differential privacy',
    ],
  },
  {
    slug: 'domain-apps',
    name: 'Domain Applications',
    group: 'application-development',
    description:
      'AI applied to a specific vertical: healthcare, finance, legal, science, education and more.',
    topics: [
      'healthcare',
      'medical',
      'bioinformatics',
      'finance',
      'quantitative-finance',
      'trading',
      'legal',
      'education',
      'scientific-computing',
      'drug-discovery',
      'chemistry',
      'geospatial',
    ],
    keywords: [
      'healthcare',
      'medical imaging',
      'clinical',
      'drug discovery',
      'protein',
      'bioinformatics',
      'financial',
      'trading bot',
      'quantitative',
      'legal documents',
      'education',
      'scientific research',
      'material science',
      'weather forecasting',
    ],
  },
  {
    slug: 'learning-resources',
    name: 'Learning & Awesome Lists',
    group: 'application-development',
    description:
      'Courses, books, tutorials, paper collections and curated awesome lists.',
    topics: [
      'awesome',
      'awesome-list',
      'tutorial',
      'course',
      'learning',
      'roadmap',
      'papers',
      'book',
      'educational',
      'interview-questions',
    ],
    keywords: [
      'awesome list',
      'curated list',
      'a list of',
      'collection of resources',
      'tutorial',
      'course',
      'learning path',
      'roadmap',
      'paper list',
      'reading list',
      'from scratch tutorial',
      'hands-on guide',
      'cheatsheet',
      'interview questions',
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const CATEGORY_BY_SLUG: ReadonlyMap<string, Category> = new Map(
  CATEGORIES.map((c) => [c.slug, c]),
);

export const GROUP_BY_SLUG: ReadonlyMap<string, Group> = new Map(
  GROUPS.map((g) => [g.slug, g]),
);

export function categoriesInGroup(group: GroupSlug): Category[] {
  return CATEGORIES.filter((c) => c.group === group);
}

/** Every topic slug we use for discovery seeding, deduplicated. */
export const ALL_TOPICS: string[] = [
  ...new Set(CATEGORIES.flatMap((c) => c.topics)),
].sort();

/**
 * Free-text phrases for topic-INDEPENDENT discovery.
 *
 * Topic search has a hard ceiling: it can only ever find repositories whose
 * authors tagged them. Measured against a 89-repo sample of genuinely popular AI
 * projects, ~67% were unreachable that way — 5 of 12 spot-checked had NO topics
 * at all (anthropics/claude-code at 139k stars, openai/codex at 102k,
 * mattpocock/skills at 196k) and others tagged things we would never seed
 * ("superpowers", "obra", "sdlc"). No amount of extra topic slugs fixes that.
 *
 * These are searched against repository NAME and DESCRIPTION only (never the
 * README), which is what keeps precision acceptable: a README mentioning "ai
 * agent" in passing says nothing, but a repo that puts it in its own description
 * is telling you what it is.
 *
 * Chosen for precision over recall — multi-word phrases, or single tokens that
 * are unambiguous in context ("llm", "agentic", "huggingface"). Deliberately NOT
 * included: bare "agent" (user agents, HTTP agents), bare "ai" (matches
 * everything), "model" (data models).
 */
export const DISCOVERY_PHRASES: string[] = [
  // agents
  'ai agent', 'ai agents', 'agentic', 'agent skills', 'autonomous agent',
  'multi-agent', 'llm agent', 'coding agent', 'agent framework', 'agent harness',
  // assistants and coding tools
  'ai assistant', 'personal ai', 'ai coding', 'coding assistant', 'claude code',
  'claude skill', 'copilot', 'codex cli', 'ai pair programmer',
  // models and LLMs
  'llm', 'large language model', 'language model', 'foundation model',
  'open weights', 'fine-tuning', 'instruction tuning',
  // retrieval
  'rag pipeline', 'retrieval augmented', 'vector database', 'semantic search',
  'embeddings model', 'knowledge graph',
  // serving and infra
  'llm inference', 'inference engine', 'model serving', 'llm gateway',
  'llm observability', 'prompt engineering', 'structured output',
  // protocols and integrations
  'mcp server', 'model context protocol', 'function calling',
  // modalities
  'text-to-speech', 'speech recognition', 'voice cloning', 'text-to-image',
  'diffusion model', 'stable diffusion', 'text-to-video', 'computer vision',
  'vision language model', 'multimodal llm',
  // classic ML
  'machine learning', 'deep learning', 'neural network', 'reinforcement learning',
  // ecosystem names that are unambiguous
  'huggingface', 'openai api', 'ollama', 'langchain', 'llamaindex',
];

// ---------------------------------------------------------------------------
// Rule-based classification
// ---------------------------------------------------------------------------

/** Topic hits are worth far more than prose hits — they are author-declared. */
const WEIGHT_TOPIC = 10;
const WEIGHT_NAME = 6;
const WEIGHT_DESCRIPTION = 3;
const WEIGHT_README = 1;

/** README hits are capped so a long README can't outvote an exact topic match. */
const README_HIT_CAP = 4;

export interface ClassifyInput {
  name: string;
  description?: string | null;
  topics?: string[] | null;
  readme?: string | null;
  language?: string | null;
}

export interface CategoryScore {
  slug: string;
  score: number;
  /** Human-readable evidence, useful for debugging and for the admin UI. */
  matched: string[];
}

/**
 * Escape a keyword for use in a RegExp, then wrap it so it only matches at
 * token boundaries. Without this, "rag" matches "storage" and "ann" matches
 * "channel" — which is exactly the kind of quiet mis-categorization that makes
 * a directory untrustworthy.
 *
 * We can't use plain \b on both sides because many keywords end in a symbol
 * (e.g. "4-bit", "text-to-3d"), so we assert on non-word characters instead.
 */
function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Treat runs of whitespace/hyphen in the keyword as interchangeable, so
  // "fine-tuning" also matches "fine tuning" and "fine   tuning".
  const flexible = escaped.replace(/[\s\\-]+/g, '[\\s\\-_]+');
  return new RegExp(`(?<![a-z0-9])${flexible}(?![a-z0-9])`, 'i');
}

/** Built once at module load — these regexes are hot in the ingestion loop. */
const COMPILED: Map<string, RegExp[]> = new Map(
  CATEGORIES.map((c) => [c.slug, c.keywords.map(keywordPattern)]),
);

/**
 * Score every category against a repo. Returns all categories with a non-zero
 * score, highest first. The caller decides the confidence threshold and
 * whether to escalate to the LLM classifier.
 */
export function scoreCategories(input: ClassifyInput): CategoryScore[] {
  const topics = new Set((input.topics ?? []).map((t) => t.toLowerCase().trim()));
  const name = (input.name ?? '').toLowerCase();
  const description = (input.description ?? '').toLowerCase();
  // Only the head of the README — the tail is usually license boilerplate,
  // contributor lists and unrelated badges that generate false positives.
  const readme = (input.readme ?? '').slice(0, 4000).toLowerCase();

  const results: CategoryScore[] = [];

  for (const category of CATEGORIES) {
    let score = 0;
    const matched: string[] = [];

    for (const topic of category.topics) {
      if (topics.has(topic)) {
        score += WEIGHT_TOPIC;
        matched.push(`topic:${topic}`);
      }
    }

    const patterns = COMPILED.get(category.slug)!;
    let readmeHits = 0;

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const keyword = category.keywords[i];

      if (pattern.test(name)) {
        score += WEIGHT_NAME;
        matched.push(`name:${keyword}`);
      }
      if (description && pattern.test(description)) {
        score += WEIGHT_DESCRIPTION;
        matched.push(`desc:${keyword}`);
      }
      if (readme && readmeHits < README_HIT_CAP && pattern.test(readme)) {
        score += WEIGHT_README;
        readmeHits++;
        matched.push(`readme:${keyword}`);
      }
    }

    if (score > 0) results.push({ slug: category.slug, score, matched });
  }

  return results.sort((a, b) => b.score - a.score);
}

export interface Classification {
  primary: string | null;
  secondary: string[];
  /** 0..1. Below ~0.5 the caller should escalate to the LLM classifier. */
  confidence: number;
  scores: CategoryScore[];
}

/**
 * Turn raw scores into a decision. Confidence reflects how decisively the top
 * category beat the runner-up — a repo that scores 30/28 across two categories
 * is genuinely ambiguous and should go to the LLM, even though 30 is a high
 * absolute score.
 */
export function classifyByRules(input: ClassifyInput): Classification {
  const scores = scoreCategories(input);

  if (scores.length === 0) {
    return { primary: null, secondary: [], confidence: 0, scores };
  }

  const [top, runnerUp] = scores;
  const margin = top.score - (runnerUp?.score ?? 0);

  // Two independent signals of trustworthiness: absolute evidence, and how
  // clearly the winner separated from the pack.
  const strength = Math.min(1, top.score / 20);
  const separation = Math.min(1, margin / 10);
  const confidence = Number((0.5 * strength + 0.5 * separation).toFixed(3));

  return {
    primary: top.slug,
    // Secondaries must be genuinely close to the winner, not merely non-zero.
    secondary: scores
      .slice(1)
      .filter((s) => s.score >= Math.max(6, top.score * 0.45))
      .slice(0, 3)
      .map((s) => s.slug),
    confidence,
    scores,
  };
}
