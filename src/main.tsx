import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  Controls,
  Edge,
  Handle,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  HelpCircle,
  ListMinus,
  Printer,
  Plus,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";

type Direction = "benefit" | "cost";
type QuantitativeDirection = Direction | "manual";
type ScaleMode = "quantitative" | "qualitative";

type Alternative = {
  id: string;
  name: string;
};

type ValueScale = {
  mode?: ScaleMode;
  autoBounds?: boolean;
  manualCurve?: boolean;
  min: number;
  max: number;
  direction: Direction;
  qualitativeOptions?: QualitativeOption[];
  valuePoints?: ValuePoint[];
};

type QualitativeOption = {
  id: string;
  label: string;
  score: number;
};

type ValuePoint = {
  id: string;
  value: number;
  score: number;
};

type Criterion = {
  id: string;
  name: string;
  weight: number;
  children?: Criterion[];
  scale?: ValueScale;
  performances?: Record<string, number | string>;
};

type DecisionModel = {
  rootName: string;
  alternatives: Alternative[];
  criteria: Criterion[];
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

type AssistantShortcut = {
  label: string;
  prompt: string;
};

type AssistantOperation =
  | { type: "setRootName"; rootName?: string }
  | { type: "replaceAlternatives"; alternatives?: string[] }
  | { type: "addAlternatives"; alternatives?: string[] }
  | { type: "removeAlternatives"; alternatives?: string[] }
  | { type: "replaceCriteria"; criteria?: Array<{ name?: string; weight?: number; subcriteria?: string[] }> }
  | { type: "addCriteria"; criteria?: Array<{ name?: string; weight?: number; subcriteria?: string[] }> }
  | { type: "removeCriteria"; criteria?: string[] }
  | { type: "setCriterionWeight"; criterion?: string; weight?: number }
  | { type: "addSubcriteria"; criterion?: string; subcriteria?: string[] }
  | { type: "configureScale"; criterion?: string; min?: number; max?: number; direction?: Direction }
  | { type: "setPerformance"; criterion?: string; alternative?: string; value?: number | string };

type AgentResponse = {
  reply: string;
  operations: AssistantOperation[];
};

type LocalAssistantResult = {
  model: DecisionModel;
  reply: string;
  selectedId?: string;
  understoodCount: number;
  clauseCount: number;
};

type PendingAssistantAction =
  | {
      type: "removeSubcriteria";
      parentId: string;
      parentName: string;
      targetName: string;
      childNames: string[];
    }
  | {
      type: "resetCriteria";
      targetName: string;
      criterionNames: string[];
    };

type ActiveModal = "alternatives" | "matrix" | "results" | "help" | null;
type HelpTopic = "use" | "method" | "steps" | "agent" | "files" | "results";
type MavtStep = 1 | 2 | 3 | 4;
type Step1Phase = "structure" | "configure";

type AppSnapshot = {
  model: DecisionModel;
  activeStep: MavtStep;
  step1Phase: Step1Phase;
  configuredCriterionIds: string[];
  alternativesReady: boolean;
  matrixReady: boolean;
  completedWeightNodeIds: string[];
  weightResetMode: boolean;
  selectedId: string;
};

type CriterionNodeData = {
  criterion?: Criterion;
  selected: boolean;
  globalWeight: number;
  isLeaf: boolean;
  isRoot: boolean;
  needsConfiguration: boolean;
  weightReady: boolean;
  clickableHint: boolean;
  showWeights: boolean;
  nameEditable: boolean;
  label: string;
  onRename?: (id: string, name: string) => void;
};

const ROOT_ID = "__overall__";
const colors = ["#78a6c8", "#f2a7a1", "#9bcf9f", "#e9c46a", "#b59bd8", "#7ac7c4"];
const mavtSteps: Array<{ id: MavtStep; title: string; caption: string }> = [
  { id: 1, title: "Critérios", caption: "Árvore, métrica e curva" },
  { id: 2, title: "Alternativas", caption: "Matriz de desempenho" },
  { id: 3, title: "Pesos", caption: "Importância local" },
  { id: 4, title: "Resultados", caption: "Ranking e sensibilidade" },
];
const assistantShortcuts: AssistantShortcut[] = [
  {
    label: "Adicionar critério",
    prompt: "Adicione [nome] em [critério pai]",
  },
  {
    label: "Ajustar peso",
    prompt: "Peso do critério [nome] para [valor]%",
  },
  {
    label: "Remover critério",
    prompt: "Remova o critério [nome]",
  },
  {
    label: "Configurar escala",
    prompt: "Configure [critério] de [mínimo] a [máximo] [menor é melhor/maior é melhor]",
  },
];

const assistantShortcutsByStep: Partial<Record<MavtStep, AssistantShortcut[]>> = {
  1: [
    {
      label: "Adicionar criterio",
      prompt: "Adicione [nome] em [criterio pai]",
    },
    {
      label: "Configurar escala",
      prompt: "Configure [criterio] de [minimo] a [maximo] [menor e melhor/maior e melhor]",
    },
    {
      label: "Curva de valor",
      prompt: "Curva de valor de [criterio]: [valor A] - [score A]; [valor B] - [score B]; ...",
    },
    {
      label: "Remover criterio",
      prompt: "Remova o criterio [nome]",
    },
  ],
  3: [
    {
      label: "Ajustar peso",
      prompt: "Peso do criterio [nome] para [valor]%",
    },
    {
      label: "Definir pesos",
      prompt: "Peso dos criterios [criterio A, criterio B, ...] para [valor de A, valor de B, ...]%",
    },
  ],
};

const helpTopics: Array<{ id: HelpTopic; label: string }> = [
  { id: "use", label: "Como usar o software" },
  { id: "method", label: "O que é o método MAVT" },
  { id: "steps", label: "Passo a passo MAVT" },
  { id: "agent", label: "Agente MAVT" },
  { id: "files", label: "Importar e exportar" },
  { id: "results", label: "Resultados e sensibilidade" },
];

const initialModel: DecisionModel = {
  rootName: "Overall",
  alternatives: [],
  criteria: [
    {
      id: "crit-1",
      name: "Critério 1",
      weight: 50,
      performances: {},
    },
    {
      id: "crit-2",
      name: "Critério 2",
      weight: 50,
      performances: {},
    },
  ],
};

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const isLeaf = (criterion: Criterion) => !criterion.children || criterion.children.length === 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const sumWeights = (items: Criterion[]) => items.reduce((sum, item) => sum + Math.max(0, item.weight), 0) || 1;
const displayWeight = (value: number) => Number(value.toFixed(2));
const formatWeight = (value: number) =>
  displayWeight(value).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const parseDecimalInput = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};

function findCriterion(criteria: Criterion[], id: string): Criterion | undefined {
  for (const criterion of criteria) {
    if (criterion.id === id) return criterion;
    const child = criterion.children ? findCriterion(criterion.children, id) : undefined;
    if (child) return child;
  }
  return undefined;
}

function findParent(criteria: Criterion[], id: string, parent?: Criterion): Criterion | undefined {
  for (const criterion of criteria) {
    if (criterion.id === id) return parent;
    const found = criterion.children ? findParent(criterion.children, id, criterion) : undefined;
    if (found) return found;
  }
  return undefined;
}

function flattenCriteria(criteria: Criterion[]): Criterion[] {
  return criteria.flatMap((criterion) => [criterion, ...flattenCriteria(criterion.children ?? [])]);
}

function updateCriterion(criteria: Criterion[], id: string, updater: (criterion: Criterion) => Criterion): Criterion[] {
  return criteria.map((criterion) => {
    if (criterion.id === id) return updater(criterion);
    if (!criterion.children) return criterion;
    return { ...criterion, children: updateCriterion(criterion.children, id, updater) };
  });
}

function removeCriterion(criteria: Criterion[], id: string): Criterion[] {
  return criteria
    .filter((criterion) => criterion.id !== id)
    .map((criterion) =>
      criterion.children ? { ...criterion, children: removeCriterion(criterion.children, id) } : criterion,
    );
}

function normalizeSiblings(items: Criterion[], changedId?: string, changedWeight?: number): Criterion[] {
  if (items.length === 0) return items;
  if (items.length === 1) return [{ ...items[0], weight: 100 }];

  const targetWeight = changedId ? clamp(Number(changedWeight), 0, 100) : undefined;
  const remaining = changedId ? 100 - (targetWeight ?? 0) : 100;
  const others = changedId ? items.filter((item) => item.id !== changedId) : items;
  const otherTotal = others.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  let accumulated = 0;

  return items.map((item, index) => {
    if (item.id === changedId) {
      accumulated += targetWeight ?? item.weight;
      return { ...item, weight: targetWeight ?? item.weight };
    }

    const pool = changedId ? remaining : 100;
    const base = otherTotal > 0 ? (Math.max(0, item.weight) / otherTotal) * pool : pool / others.length;
    const weight = index === items.length - 1 && !changedId ? 100 - accumulated : base;
    accumulated += weight;
    return { ...item, weight };
  });
}

function addWeightedSibling(items: Criterion[], item: Criterion, preferredWeight = 20) {
  return normalizeSiblings([...items, { ...item, weight: preferredWeight }], item.id, preferredWeight);
}

function setSiblingWeights(items: Criterion[], weightsById: Map<string, number>) {
  return items.map((item) => ({
    ...item,
    weight: weightsById.has(item.id) ? clamp(weightsById.get(item.id) ?? item.weight, 0, 100) : item.weight,
  }));
}

function collectLeaves(criteria: Criterion[], multiplier = 1): Array<{ criterion: Criterion; weight: number }> {
  const total = sumWeights(criteria);
  return criteria.flatMap((criterion) => {
    const local = multiplier * (Math.max(0, criterion.weight) / total);
    if (isLeaf(criterion)) return [{ criterion, weight: local }];
    return collectLeaves(criterion.children ?? [], local);
  });
}

function isPerformanceMatrixComplete(alternatives: Alternative[], leaves: Array<{ criterion: Criterion; weight: number }>) {
  return (
    alternatives.length > 0 &&
    leaves.length > 0 &&
    leaves.every(({ criterion }) =>
      alternatives.every((alternative) => {
        const value = criterion.performances?.[alternative.id];
        return value !== undefined && value !== "";
      }),
    )
  );
}

function collectWeightNodes(criteria: Criterion[]) {
  const nodes: Array<{ id: string; name: string; children: Criterion[] }> = [
    { id: ROOT_ID, name: "Raiz", children: criteria },
  ];

  const walk = (items: Criterion[]) => {
    items.forEach((criterion) => {
      if (!isLeaf(criterion)) {
        nodes.push({ id: criterion.id, name: criterion.name, children: criterion.children ?? [] });
        walk(criterion.children ?? []);
      }
    });
  };

  walk(criteria);
  return nodes.filter((node) => node.children.length > 0);
}

function hasConfiguredValueScale(criterion: Criterion) {
  const scale = criterion.scale;
  if (!scale) return false;
  const mode = scale.mode ?? "quantitative";
  if (mode === "qualitative") {
    return (scale.qualitativeOptions ?? []).length >= 2;
  }
  if (scale.manualCurve) {
    return (scale.valuePoints ?? []).length >= 2;
  }
  return Number.isFinite(scale.min) && Number.isFinite(scale.max) && scale.min !== scale.max;
}

function isPlaceholderCriterionName(name: string) {
  return /^(novo crit[eé]rio|subcrit[eé]rio|subcrit[eé]rio [ab]?)$/i.test(name.trim());
}

function canMarkCriterionConfigured(criterion: Criterion) {
  return isLeaf(criterion) && !isPlaceholderCriterionName(criterion.name) && hasConfiguredValueScale(criterion);
}

function needsCriterionConfiguration(criterion: Criterion, configuredIds: Set<string>) {
  if (isPlaceholderCriterionName(criterion.name)) return true;
  return isLeaf(criterion) && (!configuredIds.has(criterion.id) || !canMarkCriterionConfigured(criterion));
}

function isRootTarget(value: string, rootName: string) {
  const text = normalizeText(cleanName(value));
  const root = normalizeText(rootName);
  return ["raiz", "root", "objetivo", "problema", "overall"].includes(text) || Boolean(root && text === root);
}

function valueFor(criterion: Criterion, rawValue: number | string | undefined): number {
  const scale = criterion.scale ?? { min: 0, max: 10, direction: "benefit" as Direction, autoBounds: false };
  if (scale.mode === "qualitative") {
    const option = scale.qualitativeOptions?.find((item) => item.id === rawValue || item.label === rawValue);
    return clamp01((option?.score ?? 0) / 100);
  }
  const bounds = getQuantitativeBounds(criterion);
  const value = Number.isFinite(rawValue) ? Number(rawValue) : bounds.min;
  const manualScore = scale.manualCurve === true ? scoreFromValuePoints(value, scale.valuePoints) : undefined;
  if (manualScore !== undefined) return clamp01(manualScore / 100);
  const range = bounds.max - bounds.min || 1;
  const normalized = clamp01((value - bounds.min) / range);
  return scale.direction === "benefit" ? normalized : 1 - normalized;
}

function getQuantitativeBounds(criterion: Criterion) {
  const scale = criterion.scale ?? { min: 0, max: 10, direction: "benefit" as Direction, autoBounds: false };
  const values = Object.values(criterion.performances ?? {})
    .map((value) => Number(value))
    .filter(Number.isFinite);

  if (scale.autoBounds === true && values.length > 0) {
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  return { min: scale.min, max: scale.max };
}

function normalizePerformanceForScale(criterion: Criterion, value: number | string) {
  const scale = criterion.scale ?? { min: 0, max: 10, direction: "benefit" as Direction, autoBounds: false };
  if ((scale.mode ?? "quantitative") === "qualitative") return value;
  if (typeof value === "string" && value.trim() === "") return "";

  const numericValue = typeof value === "number" ? value : Number(value.replace(",", "."));
  if (!Number.isFinite(numericValue) || scale.autoBounds === true) return value;

  const min = Number.isFinite(scale.min) ? scale.min : 0;
  const max = Number.isFinite(scale.max) ? scale.max : 10;
  return clamp(numericValue, Math.min(min, max), Math.max(min, max));
}

function scoreFromValuePoints(value: number, points: ValuePoint[] | undefined) {
  const sorted = [...(points ?? [])]
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.score))
    .sort((a, b) => a.value - b.value);
  if (sorted.length < 2) return undefined;
  if (value <= sorted[0].value) return sorted[0].score;
  if (value >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1].score;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (value >= left.value && value <= right.value) {
      const span = right.value - left.value || 1;
      const ratio = (value - left.value) / span;
      return left.score + (right.score - left.score) * ratio;
    }
  }

  return undefined;
}

function calculateResults(model: DecisionModel) {
  const leaves = collectLeaves(model.criteria);
  return model.alternatives
    .map((alternative) => {
      const contributions = leaves.map(({ criterion, weight }) => {
        const raw = criterion.performances?.[alternative.id];
        return {
          id: criterion.id,
          name: criterion.name,
          value: valueFor(criterion, raw) * weight * 100,
          weight,
        };
      });
      return {
        id: alternative.id,
        name: alternative.name,
        score: contributions.reduce((sum, item) => sum + item.value, 0),
        contributions,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function layoutCriteria(
  criteria: Criterion[],
  rootName: string,
  selectedId: string | undefined,
  activeStep: MavtStep,
  step1Phase: Step1Phase,
  configuredCriterionIds: Set<string>,
  onRename: (id: string, name: string) => void,
  weightResetMode: boolean,
  currentWeightNodeId?: string,
  completedWeightNodeIds: Set<string> = new Set(),
) {
  const nodes: Node<CriterionNodeData>[] = [];
  const edges: Edge[] = [];
  const rootTotal = sumWeights(criteria);
  let leafCursor = 0;

  const walk = (criterion: Criterion, depth: number, inheritedWeight: number, siblingsTotal: number): number => {
    const globalWeight = inheritedWeight * (Math.max(0, criterion.weight) / siblingsTotal);
    const children = criterion.children ?? [];
    let y: number;

    if (children.length === 0) {
      y = leafCursor * 86;
      leafCursor += 1;
    } else {
      const childTotal = sumWeights(children);
      const childYs = children.map((child) => {
        edges.push({
          id: `${criterion.id}-${child.id}`,
          source: criterion.id,
          target: child.id,
          type: "smoothstep",
          animated: selectedId === criterion.id || selectedId === child.id,
          style: { stroke: "#1f2933", strokeWidth: selectedId === child.id ? 2.3 : 1.7 },
        });
        return walk(child, depth + 1, globalWeight, childTotal);
      });
      y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    }

    nodes.push({
      id: criterion.id,
      type: "criterion",
      position: { x: depth * 220, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        criterion,
        label: criterion.name,
        selected: selectedId === criterion.id,
        globalWeight,
        isLeaf: children.length === 0,
        isRoot: false,
        needsConfiguration: activeStep === 1 && step1Phase === "configure" && needsCriterionConfiguration(criterion, configuredCriterionIds),
        weightReady: completedWeightNodeIds.has(criterion.id),
        clickableHint:
          activeStep === 1
            ? step1Phase === "configure" && needsCriterionConfiguration(criterion, configuredCriterionIds)
            : activeStep === 3 && (weightResetMode ? children.length > 0 : currentWeightNodeId === criterion.id),
        showWeights: activeStep >= 3,
        nameEditable: activeStep === 1 && step1Phase === "configure" && children.length > 0,
        onRename,
      },
      draggable: false,
    });
    return y;
  };

  const topYs = criteria.map((criterion) => {
    edges.push({
      id: `${ROOT_ID}-${criterion.id}`,
      source: ROOT_ID,
      target: criterion.id,
      type: "smoothstep",
      animated: selectedId === ROOT_ID || selectedId === criterion.id,
      style: { stroke: "#1f2933", strokeWidth: selectedId === criterion.id ? 2.3 : 1.7 },
    });
    return walk(criterion, 1, 1, rootTotal);
  });

  const rootY = topYs.length ? (Math.min(...topYs) + Math.max(...topYs)) / 2 : 0;
  nodes.push({
    id: ROOT_ID,
    type: "criterion",
    position: { x: 0, y: rootY },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
      data: {
      label: rootName,
      selected: selectedId === ROOT_ID,
      globalWeight: 1,
      isLeaf: false,
      isRoot: true,
      needsConfiguration: false,
      weightReady: completedWeightNodeIds.has(ROOT_ID),
      clickableHint: activeStep === 3 && (weightResetMode || currentWeightNodeId === ROOT_ID),
      showWeights: activeStep >= 3,
      nameEditable: activeStep === 1 && step1Phase === "configure",
      onRename,
    },
    draggable: false,
  });

  return { nodes, edges };
}

function CriterionFlowNode({ data }: { data: CriterionNodeData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  useEffect(() => {
    if (!editing) setDraft(data.label);
  }, [data.label, editing]);

  const finishEditing = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== data.label) data.onRename?.(data.isRoot ? ROOT_ID : data.criterion?.id ?? "", next);
  };

  return (
    <div
      className={`criterion-node ${data.selected ? "selected" : ""} ${data.isRoot ? "root" : data.isLeaf ? "leaf" : "parent"} ${data.needsConfiguration ? "needs-config" : ""} ${data.clickableHint ? "clickable-hint" : ""} ${data.weightReady ? "weight-ready" : ""}`}
    >
      {!data.isRoot && <Handle type="target" position={Position.Left} className="flow-handle" />}
      {data.needsConfiguration && <span className="node-status-dot" aria-hidden="true" />}
      {editing ? (
        <input
          className="node-name-input"
          value={draft}
          autoFocus
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishEditing();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(data.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <strong
          className={data.nameEditable ? "node-name editable" : "node-name"}
          onPointerDown={(event) => {
            if (data.nameEditable) event.stopPropagation();
          }}
          onClick={(event) => {
            if (!data.nameEditable) return;
            event.stopPropagation();
            setEditing(true);
          }}
          title={data.nameEditable ? "Clique para editar o nome" : undefined}
        >
          {data.label}
        </strong>
      )}
      {!data.isRoot && data.showWeights && (
        <div className="node-meta">
          <span>{formatWeight(data.criterion?.weight ?? 100)}% local</span>
          <span>{Math.round(data.globalWeight * 100)}% global</span>
        </div>
      )}
      {!data.isLeaf && <Handle type="source" position={Position.Right} className="flow-handle" />}
    </div>
  );
}

const nodeTypes = { criterion: CriterionFlowNode };

function Modal({
  title,
  size = "medium",
  children,
  onClose,
}: {
  title: string;
  size?: "medium" | "large" | "compact" | "matrix";
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${size}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function App() {
  const [past, setPast] = useState<AppSnapshot[]>([]);
  const [future, setFuture] = useState<AppSnapshot[]>([]);
  const [model, setModel] = useState(() => ({
    ...initialModel,
    criteria: normalizeSiblings(initialModel.criteria),
  }));
  const [activeStep, setActiveStep] = useState<MavtStep>(1);
  const [step1Phase, setStep1Phase] = useState<Step1Phase>("structure");
  const [configuredCriterionIds, setConfiguredCriterionIds] = useState<Set<string>>(() => new Set());
  const [alternativesReady, setAlternativesReady] = useState(false);
  const [matrixReady, setMatrixReady] = useState(false);
  const [completedWeightNodeIds, setCompletedWeightNodeIds] = useState<Set<string>>(() => new Set());
  const [weightResetMode, setWeightResetMode] = useState(false);
  const [selectedId, setSelectedId] = useState(ROOT_ID);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [promptChipsOpen, setPromptChipsOpen] = useState(true);
  const [pendingAssistantAction, setPendingAssistantAction] = useState<PendingAssistantAction | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileMenuMode, setFileMenuMode] = useState<"root" | "export">("root");
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState<HelpTopic>("use");
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text:
        "Posso editar a estrutura por você. Entendo pedidos simples e também descrições completas com alternativas, problema central, critérios e subcritérios.",
    },
  ]);
  const [sensitivityLeafId, setSensitivityLeafId] = useState("crit-preco");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const helpMenuRef = useRef<HTMLDivElement | null>(null);

  const createSnapshot = (modelValue = model): AppSnapshot => ({
    model: modelValue,
    activeStep,
    step1Phase,
    configuredCriterionIds: Array.from(configuredCriterionIds),
    alternativesReady,
    matrixReady,
    completedWeightNodeIds: Array.from(completedWeightNodeIds),
    weightResetMode,
    selectedId,
  });

  const restoreSnapshot = (snapshot: AppSnapshot) => {
    setModel(snapshot.model);
    setActiveStep(snapshot.activeStep);
    setStep1Phase(snapshot.step1Phase);
    setConfiguredCriterionIds(new Set(snapshot.configuredCriterionIds));
    setAlternativesReady(snapshot.alternativesReady);
    setMatrixReady(snapshot.matrixReady);
    setCompletedWeightNodeIds(new Set(snapshot.completedWeightNodeIds));
    setWeightResetMode(snapshot.weightResetMode);
    setSelectedId(snapshot.selectedId);
    setActiveModal(null);
    setInspectorOpen(false);
    setNotice("");
  };

  const pushHistory = () => {
    setPast((items) => [...items, createSnapshot()].slice(-40));
    setFuture([]);
  };

  const commit = (updater: (current: DecisionModel) => DecisionModel) => {
    setModel((current) => {
      const next = updater(current);
      setPast((items) => [...items, createSnapshot(current)].slice(-40));
      setFuture([]);
      return next;
    });
  };

  const renameTreeNode = (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    if (id === ROOT_ID) {
      commit((current) => ({ ...current, rootName: clean }));
      return;
    }
    commit((current) => ({ ...current, criteria: updateCriterion(current.criteria, id, (criterion) => ({ ...criterion, name: clean })) }));
  };

  const leaves = useMemo(() => collectLeaves(model.criteria), [model.criteria]);
  const results = useMemo(() => calculateResults(model), [model]);
  const weightNodes = useMemo(() => collectWeightNodes(model.criteria), [model.criteria]);
  const currentWeightNode = useMemo(
    () => weightNodes.find((node) => !completedWeightNodeIds.has(node.id)),
    [completedWeightNodeIds, weightNodes],
  );
  const treeStructureReady = model.criteria.length > 0 && leaves.length > 0;
  const criteriaConfigurationsReady =
    flattenCriteria(model.criteria).length > 0 &&
    flattenCriteria(model.criteria).every((criterion) => !needsCriterionConfiguration(criterion, configuredCriterionIds));
  const step1Ready = step1Phase === "configure" && treeStructureReady && criteriaConfigurationsReady;
  const matrixComplete = isPerformanceMatrixComplete(model.alternatives, leaves);
  const step2Ready = alternativesReady && matrixReady && matrixComplete;
  const step3Ready = weightNodes.length > 0 && !weightResetMode && !currentWeightNode;
  const currentStepReady =
    activeStep === 1 ? step1Ready : activeStep === 2 ? step2Ready : activeStep === 3 ? step3Ready : true;
  const canExportDecision = activeStep === 4 && step1Ready && step2Ready && step3Ready;
  const assistantAvailable = activeStep === 1 || activeStep === 3;
  const visibleChatOpen = assistantAvailable && chatOpen;
  const currentAssistantShortcuts = assistantShortcutsByStep[activeStep] ?? [];
  const alternativeButtonClass =
    activeStep === 2 ? (alternativesReady ? "step2-action-ready" : "step2-action-emphasis") : "";
  const matrixButtonClass =
    activeStep === 2 && alternativesReady ? (matrixReady && matrixComplete ? "step2-action-ready" : "step2-action-emphasis") : "";

  useEffect(() => {
    if (!fileMenuOpen && !helpMenuOpen) return;

    const closeMenusOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      const clickedFileMenu = fileMenuRef.current?.contains(target);
      const clickedHelpMenu = helpMenuRef.current?.contains(target);
      if (clickedFileMenu || clickedHelpMenu) return;
      setFileMenuOpen(false);
      setHelpMenuOpen(false);
      setFileMenuMode("root");
    };

    document.addEventListener("mousedown", closeMenusOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeMenusOnOutsideClick);
  }, [fileMenuOpen, helpMenuOpen]);

  const flow = useMemo(() => layoutCriteria(
    model.criteria,
    model.rootName,
    selectedId,
    activeStep,
    step1Phase,
    configuredCriterionIds,
    renameTreeNode,
    weightResetMode,
    currentWeightNode?.id,
    completedWeightNodeIds,
  ), [
    activeStep,
    completedWeightNodeIds,
    configuredCriterionIds,
    currentWeightNode?.id,
    model.criteria,
    model.rootName,
    selectedId,
    step1Phase,
    weightResetMode,
  ]);
  const selectedCriterion = selectedId === ROOT_ID ? undefined : findCriterion(model.criteria, selectedId);
  const selectedChildren = selectedId === ROOT_ID ? model.criteria : selectedCriterion?.children ?? [];
  const selectedParent = selectedId === ROOT_ID ? undefined : findParent(model.criteria, selectedId);
  const canDeleteSelected =
    selectedId !== ROOT_ID &&
    (selectedParent ? (selectedParent.children?.length ?? 0) > 2 : model.criteria.length > 2);
  const canOpenStep = (step: MavtStep) =>
    step === 1 ||
    (step === 2 && step1Ready) ||
    (step === 3 && step1Ready && step2Ready) ||
    (step === 4 && step1Ready && step2Ready && step3Ready);
  const goToStep = (step: MavtStep) => {
    if (!canOpenStep(step)) return;
    if (step === activeStep) return;
    pushHistory();
    setActiveStep(step);
    if (step !== 3) setWeightResetMode(false);
    setActiveModal(null);
    setInspectorOpen(false);
    setNotice("");
  };
  const goToNextStep = () => {
    const next = Math.min(4, activeStep + 1) as MavtStep;
    goToStep(next);
  };
  const currentStageText =
    activeStep === 1
      ? step1Phase === "structure"
        ? "Clique nos nós para construir a árvore e adicionar subcritérios."
        : "Edite nomes de critérios compostos no nó. Clique nas folhas para editar nome, métrica e curva."
      : activeStep === 2
        ? alternativesReady
          ? "Abra a matriz para completar os desempenhos das alternativas."
          : "Clique em Alternativa para definir as opções de decisão."
      : activeStep === 3
          ? weightResetMode
            ? "Clique nos critérios destacados para redefinir pesos. Quando terminar, clique em Pronto."
            : currentWeightNode
            ? `Clique em ${currentWeightNode.id === ROOT_ID ? "Raiz" : currentWeightNode.name} para definir os pesos.`
            : "Todos os pesos foram definidos."
          : "Clique em Resultados para visualizar o ranking MAVT.";

  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [createSnapshot(), ...items]);
    restoreSnapshot(previous);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, createSnapshot()]);
    restoreSnapshot(next);
  };

  const openResults = () => {
    setNotice("");
    setInspectorOpen(false);
    setActiveModal("results");
  };

  const addRootCriterion = (names: string | string[] = "Novo critério") => {
    const criterionNames = uniqueNames(Array.isArray(names) ? names : [names]);
    if (criterionNames.length === 0) return;
    const criteria = criterionNames.map((name) => ({
      id: uid("crit"),
      name,
      weight: 20,
      performances: {},
    }));
    commit((current) => ({
      ...current,
      criteria: criteria.reduce((items, criterion) => addWeightedSibling(items, criterion, 20), current.criteria),
    }));
    setMatrixReady(false);
    setWeightResetMode(false);
    setStep1Phase("structure");
    setSelectedId(criteria[0].id);
  };

  const resetDecision = () => {
    const first: Criterion = {
      id: uid("crit"),
      name: "Critério 1",
      weight: 50,
      performances: {},
    };
    const second: Criterion = {
      id: uid("crit"),
      name: "Critério 2",
      weight: 50,
      performances: {},
    };

    commit((current) => ({
      ...current,
      rootName: "Overall",
      alternatives: [],
      criteria: [first, second],
    }));
    setActiveStep(1);
    setStep1Phase("structure");
    setConfiguredCriterionIds(new Set());
    setAlternativesReady(false);
    setMatrixReady(false);
    setCompletedWeightNodeIds(new Set());
    setWeightResetMode(false);
    setSelectedId(ROOT_ID);
    setInspectorOpen(false);
    setActiveModal(null);
  };

  const addChildCriterion = (parentId: string, names = ["Subcritério"]) => {
    const childNames = uniqueNames(names);
    if (childNames.length === 0) return;
    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, parentId, (criterion) => {
        const children = criterion.children ?? [];
        const newChildren = childNames.map((name) => ({
          id: uid("crit"),
          name,
          weight: 20,
          performances: {},
        }));
        if (children.length === 0) {
          const fallback: Criterion = {
            id: uid("crit"),
            name: "Novo subcritério",
            weight: 50,
            performances: {},
          };
          const firstChildren = newChildren.length === 1 ? [...newChildren, fallback] : newChildren;
          return { ...criterion, children: normalizeSiblings(firstChildren), scale: undefined, performances: undefined };
        }
        return { ...criterion, children: normalizeSiblings([...children, ...newChildren]), scale: undefined, performances: undefined };
      }),
    }));
    setCompletedWeightNodeIds(new Set());
    setMatrixReady(false);
    setWeightResetMode(false);
    setStep1Phase("structure");
  };

  const updateSelected = (updater: (criterion: Criterion) => Criterion) => {
    if (selectedId === ROOT_ID) return;
    commit((current) => ({ ...current, criteria: updateCriterion(current.criteria, selectedId, updater) }));
    setConfiguredCriterionIds((current) => {
      if (!current.has(selectedId)) return current;
      const next = new Set(current);
      next.delete(selectedId);
      return next;
    });
  };

  const updateSiblingWeight = (childId: string, weight: number) => {
    commit((current) => {
      if (selectedId === ROOT_ID) {
        return { ...current, criteria: normalizeSiblings(current.criteria, childId, weight) };
      }
      return {
        ...current,
        criteria: updateCriterion(current.criteria, selectedId, (criterion) => ({
          ...criterion,
          children: normalizeSiblings(criterion.children ?? [], childId, weight),
        })),
      };
    });
  };

  const deleteSelected = () => {
    if (selectedId === ROOT_ID) return;
    if (!canDeleteSelected) {
      setNotice("Não é possível remover este nó porque o pai ficaria com apenas um filho.");
      return;
    }
    commit((current) => ({ ...current, criteria: normalizeTreeAfterRemoval(removeCriterion(current.criteria, selectedId)) }));
    setConfiguredCriterionIds((current) => {
      const next = new Set(current);
      next.delete(selectedId);
      return next;
    });
    setCompletedWeightNodeIds(new Set());
    setMatrixReady(false);
    setWeightResetMode(false);
    setStep1Phase("structure");
    setSelectedId(ROOT_ID);
    setInspectorOpen(false);
  };

  const addAlternative = (name = "Nova alternativa") => {
    const alternative = { id: uid("alt"), name };
    commit((current) => ({ ...current, alternatives: [...current.alternatives, alternative] }));
    setMatrixReady(false);
  };

  const removeAlternative = (id: string) => {
    commit((current) => ({
      ...current,
      alternatives: current.alternatives.filter((alternative) => alternative.id !== id),
      criteria: updateAllLeaves(current.criteria, (criterion) => {
        const performances = { ...(criterion.performances ?? {}) };
        delete performances[id];
        return { ...criterion, performances };
      }),
    }));
    setMatrixReady(false);
  };

  const setPerformance = (criterionId: string, alternativeId: string, value: number | string) => {
    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, criterionId, (criterion) => {
        const normalizedValue = normalizePerformanceForScale(criterion, value);
        return {
          ...criterion,
          performances: { ...(criterion.performances ?? {}), [alternativeId]: normalizedValue },
        };
      }),
    }));
    setMatrixReady(false);
  };

  const markSelectedCriterionConfigured = () => {
    if (!selectedCriterion || !isLeaf(selectedCriterion) || isPlaceholderCriterionName(selectedCriterion.name)) {
      setNotice("Defina um nome específico antes de marcar o critério como pronto.");
      return;
    }
    if (selectedCriterion.scale && !hasConfiguredValueScale(selectedCriterion)) {
      setNotice("Defina uma curva de valor válida antes de marcar como pronto.");
      return;
    }
    if (!selectedCriterion.scale) {
      commit((current) => ({
        ...current,
        criteria: updateCriterion(current.criteria, selectedCriterion.id, (criterion) => ({
          ...criterion,
          scale: { min: 0, max: 10, direction: "benefit", mode: "quantitative", autoBounds: false },
        })),
      }));
    }
    setConfiguredCriterionIds((current) => new Set(current).add(selectedCriterion.id));
    setNotice("");
    setInspectorOpen(false);
  };

  const markCurrentWeightReady = () => {
    if (!currentWeightNode || selectedId !== currentWeightNode.id) {
      setNotice("Siga a ordem destacada na árvore para definir os pesos.");
      return;
    }
    pushHistory();
    setCompletedWeightNodeIds((current) => new Set(current).add(currentWeightNode.id));
    setInspectorOpen(false);
    setNotice("");
  };

  const resetWeightConfiguration = () => {
    pushHistory();
    setCompletedWeightNodeIds(new Set());
    setWeightResetMode(true);
    setSelectedId(ROOT_ID);
    setInspectorOpen(false);
    setNotice("Pesos liberados para redefinição. Clique nos critérios destacados e finalize em Pronto.");
  };

  const finishWeightReset = () => {
    pushHistory();
    setCompletedWeightNodeIds(new Set(weightNodes.map((node) => node.id)));
    setWeightResetMode(false);
    setInspectorOpen(false);
    setNotice("");
  };

  const markAlternativesReady = () => {
    if (model.alternatives.length === 0 || model.alternatives.some((alternative) => !alternative.name.trim())) {
      setNotice("Defina pelo menos uma alternativa com nome antes de avançar para a matriz.");
      return;
    }
    pushHistory();
    setAlternativesReady(true);
    setActiveModal(null);
    setNotice("");
  };

  const isMatrixComplete = () =>
    isPerformanceMatrixComplete(model.alternatives, leaves);

  const markMatrixReady = () => {
    if (!isMatrixComplete()) {
      setNotice("Complete todos os valores da matriz de desempenho antes de marcar como pronta.");
      return;
    }
    pushHistory();
    setMatrixReady(true);
    setActiveModal(null);
    setNotice("");
  };

  const convertSelectedToLeaf = () => {
    if (selectedId === ROOT_ID || !selectedCriterion || isLeaf(selectedCriterion)) return;
    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, selectedId, (criterion) => ({
        ...criterion,
        children: undefined,
        scale: undefined,
        performances: {},
      })),
    }));
    setCompletedWeightNodeIds(new Set());
    setMatrixReady(false);
    setWeightResetMode(false);
    setStep1Phase("structure");
  };

  const exportCompleteJson = () => {
    if (!canExportDecision) {
      setNotice("A exportacao fica disponivel apenas na etapa 4, com o estudo completo.");
      return;
    }
    downloadText(
      `mavt-${slugify(model.rootName || "decisão")}.json`,
      JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          model,
          results,
        },
        null,
        2,
      ),
      "application/json",
    );
  };

  const exportResultsCsv = () => {
    const headers = ["Alternativa", "Total", ...leaves.map((leaf) => leaf.criterion.name)];
    const rows = results.map((result) => [
      result.name,
      formatNumber(result.score),
      ...leaves.map((leaf) => formatNumber(result.contributions.find((item) => item.id === leaf.criterion.id)?.value ?? 0)),
    ]);
    downloadText(`resultados-${slugify(model.rootName || "decisão")}.csv`, toCsv([headers, ...rows]), "text/csv");
  };

  const exportMatrixCsv = () => {
    const headers = ["Alternativa", ...leaves.map((leaf) => leaf.criterion.name)];
    const rows = model.alternatives.map((alternative) => [
      alternative.name,
      ...leaves.map((leaf) => String(leaf.criterion.performances?.[alternative.id] ?? "")),
    ]);
    downloadText(`matriz-${slugify(model.rootName || "decisão")}.csv`, toCsv([headers, ...rows]), "text/csv");
  };

  const exportDecisionCsv = () => {
    if (!canExportDecision) {
      setNotice("A exportacao fica disponivel apenas na etapa 4, com o estudo completo.");
      return;
    }
    const matrixHeaders = ["Alternativa", ...leaves.map((leaf) => leaf.criterion.name)];
    const matrixRows = model.alternatives.map((alternative) => [
      alternative.name,
      ...leaves.map((leaf) => String(leaf.criterion.performances?.[alternative.id] ?? "")),
    ]);
    const resultHeaders = ["Alternativa", "Total", ...leaves.map((leaf) => leaf.criterion.name)];
    const resultRows = results.map((result) => [
      result.name,
      formatNumber(result.score),
      ...leaves.map((leaf) => formatNumber(result.contributions.find((item) => item.id === leaf.criterion.id)?.value ?? 0)),
    ]);

    downloadText(
      `mavt-${slugify(model.rootName || "decisão")}.csv`,
      [
        "Matriz de desempenho",
        toCsv([matrixHeaders, ...matrixRows]),
        "",
        "Tabela de desempenho MAVT",
        toCsv([resultHeaders, ...resultRows]),
      ].join("\n"),
      "text/csv",
    );
  };

  const exportResultsPdf = () => {
    window.print();
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    const extension = file.name.split(".").pop()?.toLowerCase();
    try {
      if (extension === "json") {
        const parsed = JSON.parse(text);
        const importedModel = isDecisionModel(parsed) ? parsed : isDecisionModel(parsed?.model) ? parsed.model : undefined;
        if (!importedModel) throw new Error("JSON não contém um modelo MAVT válido.");
        const sanitizedModel = sanitizeDecisionModel(importedModel);
        const importState = inferImportedModelState(sanitizedModel, importedModel);
        commit(() => sanitizedModel);
        setActiveStep(importState.activeStep);
        setStep1Phase(importState.step1Phase);
        setConfiguredCriterionIds(importState.configuredCriterionIds);
        setAlternativesReady(importState.alternativesReady);
        setMatrixReady(importState.matrixReady);
        setCompletedWeightNodeIds(importState.completedWeightNodeIds);
        setWeightResetMode(false);
        setSelectedId(ROOT_ID);
        setInspectorOpen(false);
        setActiveModal(null);
        setNotice(`Arquivo JSON importado. Continue na etapa ${importState.activeStep}.`);
        return;
      }

      if (extension === "csv" || extension === "tsv") {
        const importedModel = importMatrixTable(text, extension === "tsv" ? "\t" : ",", model);
        commit(() => importedModel);
        setSelectedId(ROOT_ID);
        setInspectorOpen(false);
        setActiveModal(null);
        setNotice("Matriz importada.");
        return;
      }

      throw new Error("Use um arquivo .json, .csv ou .tsv.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não consegui importar o arquivo.";
      setNotice(message);
      window.alert(message);
    }
  };

  const runAssistantCommand = async () => {
    if (!assistantAvailable) return;
    const text = chatInput.trim();
    if (!text || assistantThinking) return;
    setMessages((items) => [...items, { role: "user", text }]);
    setChatInput("");
    setAssistantThinking(true);

    const stepGuardMessage = getAssistantStepGuardMessage(text, activeStep);
    if (stepGuardMessage) {
      setPendingAssistantAction(null);
      setMessages((items) => [...items, { role: "assistant", text: stepGuardMessage }]);
      setAssistantThinking(false);
      return;
    }

    if (pendingAssistantAction && isConfirmationMessage(text)) {
      const applied = applyPendingAssistantAction(pendingAssistantAction, model);
      if (applied.model !== model) {
        commit(() => applied.model);
        if (applied.selectedId) setSelectedId(applied.selectedId);
      }
      setPendingAssistantAction(null);
      setMessages((items) => [...items, { role: "assistant", text: applied.reply }]);
      setAssistantThinking(false);
      return;
    }

    if (pendingAssistantAction) setPendingAssistantAction(null);

    const localResult = interpretCommandLocal(text, model, setNotice);
    const localUnderstood = localResult.understoodCount > 0;
    const localComplete = localUnderstood && localResult.understoodCount >= localResult.clauseCount;
    const pendingAction = localUnderstood ? inferPendingAssistantAction(text, model) : null;

    if (localComplete) {
      if (localResult.model !== model) {
        commit(() => localResult.model);
        if (localResult.selectedId) setSelectedId(localResult.selectedId);
      }
      setPendingAssistantAction(pendingAction);
      setMessages((items) => [...items, { role: "assistant", text: localResult.reply }]);
      setAssistantThinking(false);
      return;
    }

    try {
      const baseModel = localUnderstood ? localResult.model : model;
      const agentResponse = await requestAgentResponse(text, baseModel);
      const applied = applyAssistantOperations(agentResponse.operations, baseModel, setNotice);
      const finalModel = applied.model;
      const selectedAfter = applied.selectedId ?? localResult.selectedId;
      if (finalModel !== model) {
        commit(() => finalModel);
        if (selectedAfter) setSelectedId(selectedAfter);
      }
      const aiPendingAction = inferPendingAssistantAction(text, baseModel);
      if (finalModel === baseModel && agentResponse.operations.length === 0 && aiPendingAction) {
        const reply = pendingAssistantActionPrompt(aiPendingAction);
        setPendingAssistantAction(aiPendingAction);
        setNotice(reply);
        setMessages((items) => [...items, { role: "assistant", text: reply }]);
      } else {
        setPendingAssistantAction(null);
        const reply =
          localUnderstood && agentResponse.reply
            ? `${localResult.reply} ${agentResponse.reply}`
            : agentResponse.reply;
        setMessages((items) => [...items, { role: "assistant", text: reply }]);
      }
    } catch (error) {
      const detail = summarizeAgentError(error);
      if (localUnderstood) {
        if (localResult.model !== model) {
          commit(() => localResult.model);
          if (localResult.selectedId) setSelectedId(localResult.selectedId);
        }
        setPendingAssistantAction(pendingAction);
        setMessages((items) => [
          ...items,
          {
            role: "assistant",
            text: `${localResult.reply} Consegui aplicar parte do pedido com o agente local, mas a IA externa falhou ao interpretar o restante: ${detail}`,
          },
        ]);
      } else {
        setPendingAssistantAction(null);
        setMessages((items) => [
          ...items,
          {
            role: "assistant",
            text: `Ainda não consegui transformar esse texto em alterações. A IA externa também falhou: ${detail}`,
          },
        ]);
      }
    } finally {
      setAssistantThinking(false);
    }
  };

  const sensitivityData = useMemo(() => {
    const leaf = leaves.find((item) => item.criterion.id === sensitivityLeafId) ?? leaves[0];
    if (!leaf) return [];
    return [0.5, 0.75, 1, 1.25, 1.5].map((factor) => {
      const adjustedLeaves = leaves.map((item) => ({
        ...item,
        weight: item.criterion.id === leaf.criterion.id ? item.weight * factor : item.weight,
      }));
      const total = adjustedLeaves.reduce((sum, item) => sum + item.weight, 0) || 1;
      const row: Record<string, string | number> = { ajuste: `${Math.round(factor * 100)}%` };
      model.alternatives.forEach((alternative) => {
        row[alternative.name] = adjustedLeaves.reduce((sum, item) => {
          const normalizedWeight = item.weight / total;
          return sum + valueFor(item.criterion, item.criterion.performances?.[alternative.id]) * normalizedWeight * 100;
        }, 0);
      });
      return row;
    });
  }, [leaves, model.alternatives, sensitivityLeafId]);

  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              <SlidersHorizontal size={20} />
            </div>
            <div>
              <h1>MAVT Workspace</h1>
              <p>Teoria do Valor de Múltiplos Atributos</p>
            </div>
          </div>

          <nav className="stepper" aria-label="Etapas MAVT">
            {mavtSteps.map((step) => {
              const open = canOpenStep(step.id);
              return (
                <button
                  key={step.id}
                  className={`${activeStep === step.id ? "active" : ""} ${open ? "" : "locked"}`}
                  onClick={() => goToStep(step.id)}
                  disabled={!open}
                  title={step.caption}
                >
                  <span>{step.id}</span>
                  <strong>{step.title}</strong>
                </button>
              );
            })}
          </nav>

          <div className="toolbar">
            <button
              className={`primary ${activeStep === 4 ? "results-emphasis" : ""}`}
              onClick={openResults}
              disabled={activeStep !== 4}
            >
              <BarChart3 size={16} />
              Resultados
            </button>
            <button
              className={alternativeButtonClass}
              onClick={() => setActiveModal("alternatives")}
              disabled={activeStep !== 2}
            >
              <Plus size={16} />
              Alternativa
            </button>
            <button
              className={matrixButtonClass}
              onClick={() => setActiveModal("matrix")}
              disabled={activeStep !== 2 || !alternativesReady}
            >
              <Table2 size={16} />
              Matriz
            </button>
            <div className="file-menu" ref={fileMenuRef}>
              <button
                onClick={() => {
                  setFileMenuOpen((open) => !open);
                  setFileMenuMode("root");
                }}
              >
                <FileJson size={16} />
                Arquivos
              </button>
              {fileMenuOpen && (
                <div className="file-menu-popover">
                  {fileMenuMode === "root" ? (
                    <>
                      <button
                        onClick={() => {
                          setFileMenuOpen(false);
                          setFileMenuMode("root");
                          fileInputRef.current?.click();
                        }}
                      >
                        <Upload size={16} />
                        Importar
                      </button>
                      <button
                        onClick={() => setFileMenuMode("export")}
                        disabled={!canExportDecision}
                        title={canExportDecision ? "Exportar estudo completo" : "DisponÃ­vel apenas na etapa 4"}
                      >
                        <Download size={16} />
                        Exportar
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="menu-back-button" onClick={() => setFileMenuMode("root")}>
                        <ChevronLeft size={16} />
                        Voltar
                      </button>
                      <button
                        onClick={() => {
                          setFileMenuOpen(false);
                          setFileMenuMode("root");
                          exportCompleteJson();
                        }}
                      >
                        <FileJson size={16} />
                        JSON
                      </button>
                      <button
                        onClick={() => {
                          setFileMenuOpen(false);
                          setFileMenuMode("root");
                          exportDecisionCsv();
                        }}
                      >
                        <Table2 size={16} />
                        CSV
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="file-menu" ref={helpMenuRef}>
              <button onClick={() => setHelpMenuOpen((open) => !open)}>
                <HelpCircle size={16} />
                Ajuda
              </button>
              {helpMenuOpen && (
                <div className="file-menu-popover help-menu-popover">
                  {helpTopics.map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => {
                        setHelpTopic(topic.id);
                        setHelpMenuOpen(false);
                        setActiveModal("help");
                      }}
                    >
                      {topic.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="danger" onClick={resetDecision}>
              <RotateCcw size={16} />
              Reiniciar
            </button>
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
          </div>

          <div className="history-controls">
            <button className="icon-button" onClick={undo} disabled={past.length === 0} aria-label="Desfazer">
              <Undo2 size={17} />
            </button>
            <button className="icon-button" onClick={redo} disabled={future.length === 0} aria-label="Refazer">
              <Redo2 size={17} />
            </button>
          </div>
        </header>

        <main className={`workspace ${visibleChatOpen ? "with-chat" : ""}`}>
          <section className="tree-workspace">
            <div className="panel-heading tree-title-heading">
              <div className="stage-helper">
                <span className="eyebrow">
                  Etapa {activeStep}
                  {activeStep === 1 ? ` · ${step1Phase === "structure" ? "Construir árvore" : "Configurar critérios"}` : ""}
                </span>
                <p>{currentStageText}</p>
                {activeStep === 1 && (
                  <div className="stage-phase-track" aria-label="Fases da etapa 1">
                    <button
                      className={step1Phase === "structure" ? "selected" : ""}
                      onClick={() => {
                        if (step1Phase !== "structure") pushHistory();
                        setStep1Phase("structure");
                        setInspectorOpen(false);
                        setNotice("");
                      }}
                    >
                      1A Construir árvore
                    </button>
                    <button
                      className={step1Phase === "configure" ? "selected" : ""}
                      onClick={() => {
                        if (step1Phase !== "configure") pushHistory();
                        setStep1Phase("configure");
                        setInspectorOpen(false);
                        setNotice("");
                      }}
                      disabled={!treeStructureReady}
                    >
                      1B Configurar critérios
                    </button>
                  </div>
                )}
              </div>
              <div className="stage-actions">
                {activeStep === 1 && step1Phase === "structure" && (
                  <button
                    className="primary"
                    onClick={() => {
                      pushHistory();
                      setStep1Phase("configure");
                      setInspectorOpen(false);
                      setNotice("");
                    }}
                    disabled={!treeStructureReady}
                  >
                    Configurar critérios
                    <ChevronRight size={16} />
                  </button>
                )}
                {activeStep === 1 && step1Phase === "configure" && (
                  <button
                    onClick={() => {
                      pushHistory();
                      setStep1Phase("structure");
                      setInspectorOpen(false);
                      setNotice("");
                    }}
                  >
                    <ChevronLeft size={16} />
                    Voltar para árvore
                  </button>
                )}
                {activeStep === 3 && !weightResetMode && completedWeightNodeIds.size > 0 && (
                  <button onClick={resetWeightConfiguration}>
                    <RotateCcw size={16} />
                    Redefinir pesos
                  </button>
                )}
                {activeStep === 3 && weightResetMode && (
                  <button className="primary next-step-ready" onClick={finishWeightReset}>
                    <CheckCircle2 size={16} />
                    Pronto
                  </button>
                )}
                {activeStep < 4 && currentStepReady && (
                  <button className="primary next-step-ready" onClick={goToNextStep}>
                    <CheckCircle2 size={16} />
                    Próxima etapa
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="flow-wrap main-tree">
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.35}
                maxZoom={1.4}
                onNodeClick={(_, node) => {
                  if (activeStep === 2 || activeStep === 4) return;
                  const clickedCriterion = node.id === ROOT_ID ? undefined : findCriterion(model.criteria, node.id);
                  if (activeStep === 1 && step1Phase === "configure") {
                    if (!clickedCriterion || !isLeaf(clickedCriterion)) {
                      setNotice("Nesta fase, edite o nome diretamente no nó. Use Voltar para árvore para mudar a estrutura.");
                      return;
                    }
                  }
                  if (activeStep === 3) {
                    if (weightResetMode) {
                      if (node.id !== ROOT_ID && (!clickedCriterion || isLeaf(clickedCriterion))) {
                        setNotice("Na redefinição de pesos, clique na raiz ou em critérios compostos destacados.");
                        return;
                      }
                    } else if (node.id !== currentWeightNode?.id) {
                      setNotice("Clique no nó destacado para seguir a ordem dos pesos.");
                      return;
                    }
                  }
                  setSelectedId(node.id);
                  setNotice("");
                  setInspectorOpen(true);
                }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#e5e7eb" gap={24} />
                <Controls />
              </ReactFlow>
            </div>
          </section>

          {assistantAvailable && !chatOpen && (
            <button className="chat-restore" onClick={() => setChatOpen(true)} aria-label="Abrir chat da IA">
              <ChevronLeft size={18} />
              IA
            </button>
          )}

          {assistantAvailable && (
          <aside className={`ai-panel ${chatOpen ? "open" : "closed"}`}>
            <div className="ai-heading">
              <div className="ai-avatar">
                <Bot size={19} />
              </div>
              <div>
                <h2>Agente MAVT</h2>
                <p>Edite por linguagem natural</p>
              </div>
              <button className="icon-button chat-toggle" onClick={() => setChatOpen(false)} aria-label="Recolher chat">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="messages">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
                  {message.text}
                </div>
              ))}
            </div>
            <div className="chat-composer">
              {promptChipsOpen && (
                <div className="prompt-chips" aria-label="Sugestões para o agente">
                  {currentAssistantShortcuts.map((shortcut) => (
                    <button
                      key={shortcut.label}
                      type="button"
                      onClick={() => setChatInput(shortcut.prompt)}
                      title={shortcut.prompt}
                    >
                      {shortcut.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="chat-box">
                <button
                  className="prompt-toggle"
                  type="button"
                  onClick={() => setPromptChipsOpen((current) => !current)}
                  aria-label={promptChipsOpen ? "Recolher prompts recomendados" : "Mostrar prompts recomendados"}
                  title={promptChipsOpen ? "Recolher prompts recomendados" : "Mostrar prompts recomendados"}
                >
                  <HelpCircle size={18} />
                </button>
                <textarea
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onInput={(event) => autoResizeTextarea(event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void runAssistantCommand();
                    }
                  }}
                  placeholder={
                    assistantThinking
                      ? "Agente pensando..."
                      : activeStep === 1
                        ? "Ex: adicione prazo em qualidade"
                        : "Ex: peso do custo para 35%"
                  }
                  disabled={assistantThinking}
                  rows={1}
                />
                <button onClick={runAssistantCommand} aria-label="Enviar comando" disabled={assistantThinking}>
                  <Sparkles size={18} />
                </button>
              </div>
            </div>
          </aside>
          )}
        </main>

        {activeModal === "results" && (
          <Modal title="Resultados da decisão" size="large" onClose={() => setActiveModal(null)}>
            <div className="results-window">
              <ResultsPanel
                results={results}
                leaves={leaves}
                sensitivityData={sensitivityData}
                sensitivityLeafId={sensitivityLeafId}
                onSensitivityChange={setSensitivityLeafId}
                alternatives={model.alternatives}
                onExportPdf={exportResultsPdf}
              />
            </div>
          </Modal>
        )}

        {inspectorOpen && (
          <Modal
            title={selectedId === ROOT_ID ? `Editar ${model.rootName}` : `Editar ${selectedCriterion?.name ?? "critério"}`}
            size="compact"
            onClose={() => setInspectorOpen(false)}
          >
            <CriterionInspector
              activeStep={activeStep}
              step1Phase={step1Phase}
              selectedId={selectedId}
              criterion={selectedCriterion}
              children={selectedChildren}
              alternatives={model.alternatives}
              canDelete={canDeleteSelected}
              notice={notice}
              criterionConfigured={
                selectedCriterion
                  ? configuredCriterionIds.has(selectedCriterion.id) && canMarkCriterionConfigured(selectedCriterion)
                  : false
              }
              currentWeightNodeId={currentWeightNode?.id}
              weightResetMode={weightResetMode}
              rootName={model.rootName}
              onChange={updateSelected}
              onRootNameChange={(rootName) => commit((current) => ({ ...current, rootName }))}
              onSiblingWeightChange={updateSiblingWeight}
              onDelete={deleteSelected}
              onAddChildren={(names) => {
                selectedId === ROOT_ID ? addRootCriterion(names) : addChildCriterion(selectedId, names);
                setInspectorOpen(false);
              }}
              onConvertToLeaf={convertSelectedToLeaf}
              onMarkCriterionConfigured={markSelectedCriterionConfigured}
              onMarkWeightsReady={markCurrentWeightReady}
              onPerformanceChange={(alternativeId, value) =>
                selectedId !== ROOT_ID && setPerformance(selectedId, alternativeId, value)
              }
            />
          </Modal>
        )}

        {activeModal === "alternatives" && (
          <AlternativesModal
            alternatives={model.alternatives}
            onClose={() => setActiveModal(null)}
            onAdd={addAlternative}
            onReady={markAlternativesReady}
            onRemove={removeAlternative}
            onRename={(id, name) =>
              commit((current) => ({
                ...current,
                alternatives: current.alternatives.map((alternative) =>
                  alternative.id === id ? { ...alternative, name } : alternative,
                ),
              }))
            }
          />
        )}

        {activeModal === "matrix" && (
          <MatrixModal
            alternatives={model.alternatives}
            leaves={leaves}
            onClose={() => setActiveModal(null)}
            onReady={markMatrixReady}
            onPerformanceChange={setPerformance}
          />
        )}

        {activeModal === "help" && (
          <Modal title="Ajuda" size="compact" onClose={() => setActiveModal(null)}>
            <HelpPanel topic={helpTopic} onTopicChange={setHelpTopic} />
          </Modal>
        )}
      </div>
    </ReactFlowProvider>
  );
}

function normalizeTreeAfterRemoval(criteria: Criterion[]): Criterion[] {
  return normalizeSiblings(
    criteria.map((criterion) =>
      criterion.children ? { ...criterion, children: normalizeTreeAfterRemoval(criterion.children) } : criterion,
    ),
  );
}

function updateAllLeaves(criteria: Criterion[], updater: (criterion: Criterion) => Criterion): Criterion[] {
  return criteria.map((criterion) => {
    if (isLeaf(criterion)) return updater(criterion);
    return { ...criterion, children: updateAllLeaves(criterion.children ?? [], updater) };
  });
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Array<Array<string | number>>) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(","),
    )
    .join("\n");
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function importMatrixTable(text: string, delimiter: string, current: DecisionModel): DecisionModel {
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2) throw new Error("A planilha precisa ter cabeçalho e pelo menos uma alternativa.");
  const headers = rows[0].map((header) => header.trim()).filter(Boolean);
  if (headers.length < 2 || normalizeText(headers[0]) !== "alternativa") {
    throw new Error('A primeira coluna da planilha deve ser "Alternativa".');
  }

  const alternatives = rows.slice(1).map((row) => ({ id: uid("alt"), name: cleanName(row[0] || "Alternativa") }));
  const leaves = headers.slice(1).map((name, columnIndex) => {
    const criterion = createCriterion(name, 100 / Math.max(1, headers.length - 1), alternatives);
    criterion.performances = Object.fromEntries(
      alternatives.map((alternative, rowIndex) => {
        const raw = rows[rowIndex + 1]?.[columnIndex + 1] ?? "";
        const numeric = Number(raw.replace(",", "."));
        return [alternative.id, Number.isFinite(numeric) && raw !== "" ? numeric : raw];
      }),
    );
    return criterion;
  });

  return {
    ...current,
    alternatives,
    criteria: normalizeSiblings(leaves),
  };
}

function isDecisionModel(value: unknown): value is DecisionModel {
  const model = value as DecisionModel;
  return Boolean(
    model &&
      typeof model.rootName === "string" &&
      Array.isArray(model.alternatives) &&
      Array.isArray(model.criteria),
  );
}

function sanitizeDecisionModel(model: DecisionModel): DecisionModel {
  return {
    rootName: model.rootName || "Decisão",
    alternatives: model.alternatives.map((alternative) => ({
      id: alternative.id || uid("alt"),
      name: alternative.name || "Alternativa",
    })),
    criteria: normalizeTreeAfterRemoval(sanitizeCriteria(model.criteria)),
  };
}

function sanitizeCriteria(criteria: Criterion[]): Criterion[] {
  return criteria.map((criterion) => {
    const children = criterion.children ? sanitizeCriteria(criterion.children) : undefined;
    return {
      ...criterion,
      id: criterion.id || uid("crit"),
      name: criterion.name || "Critério",
      weight: Number.isFinite(criterion.weight) ? criterion.weight : 100,
      children,
    };
  });
}

function inferImportedModelState(model: DecisionModel, rawModel: DecisionModel) {
  const leaves = collectLeaves(model.criteria);
  const allCriteria = flattenCriteria(model.criteria);
  const configuredCriterionIds = new Set(
    allCriteria.filter((criterion) => isLeaf(criterion) && canMarkCriterionConfigured(criterion)).map((criterion) => criterion.id),
  );
  const alternativesReady =
    model.alternatives.length > 0 && model.alternatives.every((alternative) => alternative.name.trim().length > 0);
  const matrixReady = alternativesReady && isPerformanceMatrixComplete(model.alternatives, leaves);
  const weightNodes = collectWeightNodes(model.criteria);
  const weightsReady = hasDefinedWeightGroups(rawModel.criteria);
  const completedWeightNodeIds = new Set(weightsReady ? weightNodes.map((node) => node.id) : []);
  const treeStructureReady = model.criteria.length > 0 && leaves.length > 0;
  const criteriaReady =
    allCriteria.length > 0 &&
    allCriteria.every((criterion) => !needsCriterionConfiguration(criterion, configuredCriterionIds));

  if (!treeStructureReady) {
    return {
      activeStep: 1 as MavtStep,
      step1Phase: "structure" as Step1Phase,
      configuredCriterionIds,
      alternativesReady,
      matrixReady,
      completedWeightNodeIds,
    };
  }

  if (!criteriaReady) {
    return {
      activeStep: 1 as MavtStep,
      step1Phase: "configure" as Step1Phase,
      configuredCriterionIds,
      alternativesReady,
      matrixReady,
      completedWeightNodeIds,
    };
  }

  if (!matrixReady) {
    return {
      activeStep: 2 as MavtStep,
      step1Phase: "configure" as Step1Phase,
      configuredCriterionIds,
      alternativesReady,
      matrixReady,
      completedWeightNodeIds,
    };
  }

  if (!weightsReady) {
    return {
      activeStep: 3 as MavtStep,
      step1Phase: "configure" as Step1Phase,
      configuredCriterionIds,
      alternativesReady,
      matrixReady,
      completedWeightNodeIds,
    };
  }

  return {
    activeStep: 4 as MavtStep,
    step1Phase: "configure" as Step1Phase,
    configuredCriterionIds,
    alternativesReady,
    matrixReady,
    completedWeightNodeIds,
  };
}

function hasDefinedWeightGroups(criteria: Criterion[]) {
  const rawCriteria = criteria as Array<Criterion & { weight?: unknown }>;
  const groups: Array<Array<Criterion & { weight?: unknown }>> = [rawCriteria];
  const walk = (items: Array<Criterion & { weight?: unknown }>) => {
    items.forEach((criterion) => {
      const children = criterion.children as Array<Criterion & { weight?: unknown }> | undefined;
      if (children && children.length > 0) {
        groups.push(children);
        walk(children);
      }
    });
  };
  walk(rawCriteria);

  return groups.every((group) => {
    if (group.length === 0) return false;
    const weights = group.map((criterion) => Number(criterion.weight));
    if (!weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 100)) return false;
    const sum = weights.reduce((total, weight) => total + weight, 0);
    return Math.abs(sum - 100) <= 0.01;
  });
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTooltipNumber(value: unknown): string | number {
  return typeof value === "number" ? formatNumber(value) : String(value ?? "");
}

function slugify(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mavt";
}

function autoResizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
}

async function requestAgentResponse(message: string, model: DecisionModel): Promise<AgentResponse> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, model }),
  });
  const data = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(data?.error ?? "falha no endpoint /api/agent");
  }

  return {
    reply: typeof data?.reply === "string" ? data.reply : "Entendi.",
    operations: Array.isArray(data?.operations) ? data.operations : [],
  };
}

function summarizeAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  const normalized = normalizeText(message);
  if (normalized.includes("json valido") || normalized.includes("json")) {
    return "A IA respondeu fora do formato esperado.";
  }
  if (normalized.includes("credit") || normalized.includes("402") || normalized.includes("can only afford")) {
    return "A IA externa retornou erro de créditos.";
  }
  if (normalized.includes("401") || normalized.includes("403") || normalized.includes("auth") || normalized.includes("user not found")) {
    return "A IA externa retornou erro de autenticação.";
  }
  if (normalized.includes("endpoint") || normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "O endpoint da IA não respondeu.";
  }
  return message;
}

function applyAssistantOperations(
  operations: AssistantOperation[],
  model: DecisionModel,
  setNotice: (text: string) => void,
) {
  let draft = model;
  let selectedId: string | undefined;

  for (const operation of operations) {
    switch (operation.type) {
      case "setRootName": {
        const rootName = cleanName(operation.rootName ?? "");
        if (rootName) draft = { ...draft, rootName };
        break;
      }
      case "replaceAlternatives": {
        const alternatives = uniqueNames(operation.alternatives ?? []).map((name) => ({ id: uid("alt"), name }));
        if (alternatives.length > 0) {
          draft = {
            ...draft,
            alternatives,
            criteria: updateAllLeaves(draft.criteria, (criterion) => ({ ...criterion, performances: {} })),
          };
        }
        break;
      }
      case "addAlternatives": {
        const existing = draft.alternatives.map((alternative) => normalizeText(alternative.name));
        const additions = uniqueNames(operation.alternatives ?? [])
          .filter((name) => !existing.includes(normalizeText(name)))
          .map((name) => ({ id: uid("alt"), name }));
        if (additions.length > 0) draft = { ...draft, alternatives: [...draft.alternatives, ...additions] };
        break;
      }
      case "replaceCriteria": {
        const criteria = buildCriteriaFromAgentItems(operation.criteria ?? [], draft.alternatives);
        if (criteria.length > 0) {
          draft = { ...draft, criteria: normalizeSiblings(criteria) };
          selectedId = ROOT_ID;
        }
        break;
      }
      case "removeAlternatives": {
        for (const name of operation.alternatives ?? []) {
          const alternative = findAlternativeByName(draft.alternatives, name);
          if (alternative) draft = removeAlternativeFromModel(draft, alternative.id);
        }
        break;
      }
      case "addCriteria": {
        const criteria = buildCriteriaFromAgentItems(operation.criteria ?? [], draft.alternatives);
        if (criteria.length > 0) {
          draft = {
            ...draft,
            criteria: criteria.reduce(
              (items, criterion) => addWeightedSibling(items, criterion, criterion.weight),
              draft.criteria,
            ),
          };
          selectedId = criteria[0].id;
        }
        break;
      }
      case "removeCriteria": {
        for (const name of operation.criteria ?? []) {
          const criterion = findCriterionByName(draft.criteria, name);
          if (!criterion) continue;
          const parent = findParent(draft.criteria, criterion.id);
          const canRemove = parent ? (parent.children?.length ?? 0) > 2 : draft.criteria.length > 2;
          if (!canRemove) {
            setNotice(buildBlockedCriterionRemovalMessage(criterion, parent, draft.criteria));
            continue;
          }
          draft = { ...draft, criteria: normalizeTreeAfterRemoval(removeCriterion(draft.criteria, criterion.id)) };
          selectedId = parent?.id ?? ROOT_ID;
        }
        break;
      }
      case "setCriterionWeight": {
        const criterion = findCriterionByName(draft.criteria, operation.criterion ?? "");
        const weight = Number(operation.weight);
        if (!criterion || !Number.isFinite(weight)) break;
        const parent = findParent(draft.criteria, criterion.id);
        draft = !parent
          ? { ...draft, criteria: normalizeSiblings(draft.criteria, criterion.id, weight) }
          : {
              ...draft,
              criteria: updateCriterion(draft.criteria, parent.id, (item) => ({
                ...item,
                children: normalizeSiblings(item.children ?? [], criterion.id, weight),
              })),
            };
        selectedId = parent?.id ?? ROOT_ID;
        break;
      }
      case "addSubcriteria": {
        const parent = findCriterionByName(draft.criteria, operation.criterion ?? "");
        const names = uniqueNames(operation.subcriteria ?? []);
        if (parent && names.length > 0) {
          draft = addSubcriteriaToModel(draft, parent.id, names);
          selectedId = parent.id;
        }
        break;
      }
      case "configureScale": {
        const criterion = findCriterionByName(draft.criteria, operation.criterion ?? "");
        const min = Number(operation.min);
        const max = Number(operation.max);
        if (!criterion || !isLeaf(criterion) || !Number.isFinite(min) || !Number.isFinite(max)) break;
        const direction: Direction = operation.direction === "cost" ? "cost" : "benefit";
        draft = {
          ...draft,
          criteria: updateCriterion(draft.criteria, criterion.id, (item) => ({
            ...item,
            scale: { min, max, direction, mode: "quantitative", autoBounds: false },
          })),
        };
        selectedId = criterion.id;
        break;
      }
      case "setPerformance": {
        const criterion = findCriterionByName(draft.criteria, operation.criterion ?? "");
        const alternative = findAlternativeByName(draft.alternatives, operation.alternative ?? "");
        if (!criterion || !alternative || !isLeaf(criterion) || operation.value === undefined) break;
        const value =
          typeof operation.value === "number" || (typeof operation.value === "string" && operation.value.trim())
            ? operation.value
            : undefined;
        if (value === undefined) break;
        draft = {
          ...draft,
          criteria: updateCriterion(draft.criteria, criterion.id, (item) => {
            const normalizedValue = normalizePerformanceForScale(item, value);
            return {
              ...item,
              performances: { ...(item.performances ?? {}), [alternative.id]: normalizedValue },
            };
          }),
        };
        selectedId = criterion.id;
        break;
      }
      default:
        break;
    }
  }

  return { model: draft, selectedId };
}

function interpretCommand(
  rawText: string,
  model: DecisionModel,
  commit: (updater: (current: DecisionModel) => DecisionModel) => void,
  setSelectedId: (id: string) => void,
  setNotice: (text: string) => void,
) {
  const result = interpretCommandLocal(rawText, model, setNotice);
  if (result.model !== model) {
    commit(() => result.model);
    if (result.selectedId) setSelectedId(result.selectedId);
  }
  return result.reply;
}

function interpretCommandLocal(
  rawText: string,
  model: DecisionModel,
  setNotice: (text: string) => void,
): LocalAssistantResult {
  let draft = model;
  let selectedAfter: string | undefined;
  const replies: string[] = [];
  let understoodCount = 0;
  const structured = interpretStructuredDescription(rawText, draft);

  if (structured.model !== draft) {
    draft = structured.model;
    replies.push(...structured.replies);
    selectedAfter = ROOT_ID;
    understoodCount += 1;
  }

  const clauses = /^curva\s+de\s+valor\s+de\s+.+?:/i.test(rawText.trim())
    ? [rawText.trim()]
    : splitAssistantClauses(rawText);
  const effectiveClauses = structured.model !== model
    ? clauses.filter((clause) => !isStructuredDescription(normalizeText(clause)))
    : clauses;

  for (const clause of effectiveClauses) {
    const result = applyAssistantClause(clause, draft, setNotice);
    if (!result) continue;
    draft = result.model;
    replies.push(result.reply);
    selectedAfter = result.selectedId ?? selectedAfter;
    understoodCount += 1;
  }

  const uniqueReplies = Array.from(new Set(replies.filter(Boolean)));
  const possibleExtraCommand =
    effectiveClauses.length === 1 &&
    /\s+e\s+\S+/i.test(rawText) &&
    !/\b(?:alternativas?|crit[eé]rios?|subcrit[eé]rios?)\b/i.test(rawText);
  const clauseCount = Math.max(1, effectiveClauses.length + (structured.model !== model ? 1 : 0) + (possibleExtraCommand ? 1 : 0));

  if (draft !== model) {
    return {
      model: draft,
      selectedId: selectedAfter,
      understoodCount,
      clauseCount,
      reply: uniqueReplies.length
      ? uniqueReplies.join(" ")
      : "Atualizei o modelo com as instruções que consegui interpretar.",
    };
  }
  if (uniqueReplies.length) {
    return {
      model: draft,
      selectedId: selectedAfter,
      understoodCount,
      clauseCount,
      reply: uniqueReplies.join(" "),
    };
  }

  return {
    model: draft,
    selectedId: selectedAfter,
    understoodCount,
    clauseCount,
    reply: "Ainda não consegui transformar esse texto em alterações. Tente citar alternativas, critérios, pesos, subcritérios ou uma curva de valor.",
  };
}

function getAssistantStepGuardMessage(text: string, activeStep: MavtStep) {
  const normalized = normalizeText(text);
  const isWeightCommand = /\bpeso\b|\bpesos\b|\bponderacao\b/.test(normalized);
  const isStructureAction = /\b(adicione|adicionar|inclua|incluir|crie|criar|remova|remover|apague|apagar|exclua|excluir|delete)\b/.test(normalized);
  const isCriterionConfigCommand = /\b(subcriterio|subcriterios|escala|curva de valor|funcao de valor|metrica)\b/.test(normalized);
  const isStep2Command = /\b(alternativa|alternativas|matriz|desempenho)\b/.test(normalized);

  if (activeStep === 1 && (isWeightCommand || isStep2Command)) {
    return "Na etapa 1, o agente aceita apenas comandos de construcao e configuracao dos criterios.";
  }

  if (activeStep === 3 && (isStructureAction || isCriterionConfigCommand || isStep2Command)) {
    return "Na etapa 3, o agente aceita apenas comandos relacionados aos pesos.";
  }

  return "";
}

function buildBlockedCriterionRemovalMessage(criterion: Criterion, parent: Criterion | undefined, rootCriteria: Criterion[]) {
  if (parent) {
    const siblingNames = (parent.children ?? []).map((child) => child.name).join(" e ");
    return `Não removi ${criterion.name}, porque ${parent.name} ficaria com apenas um subcritério. Cada critério composto precisa ter no mínimo 2 subcritérios. Posso remover os dois subcritérios de ${parent.name} (${siblingNames}) e transformar ${parent.name} em folha?`;
  }

  const rootNames = rootCriteria.map((item) => item.name).join(" e ");
  return `Não removi ${criterion.name}, porque a árvore ficaria com apenas um critério principal. A raiz precisa ter no mínimo 2 critérios. Posso remover os critérios principais (${rootNames}) e reiniciar a estrutura?`;
}

function isConfirmationMessage(rawText: string) {
  const text = normalizeText(rawText);
  return /^(sim|pode|pode sim|ok|confirmo|confirmado|claro|remova|remover)(\.|!|\s)*$/.test(text);
}

function inferPendingAssistantAction(rawText: string, model: DecisionModel): PendingAssistantAction | null {
  const text = normalizeText(rawText);
  const match =
    text.match(/(?:remova|remover|apague|apagar|exclua|excluir|delete)\s+(?:o\s+)?criterio\s+(.+)/) ??
    text.match(/^(?:remova|remover|apague|apagar|exclua|excluir|delete)\s+(.+)$/);
  const target = match?.[1] ? removeTrailingCommand(match[1]) : "";
  if (!target) return null;

  const criterion = findCriterionByName(model.criteria, target);
  if (!criterion) return null;
  const parent = findParent(model.criteria, criterion.id);
  if (parent && (parent.children?.length ?? 0) <= 2) {
    return {
      type: "removeSubcriteria",
      parentId: parent.id,
      parentName: parent.name,
      targetName: criterion.name,
      childNames: (parent.children ?? []).map((child) => child.name),
    };
  }

  if (!parent && model.criteria.length <= 2) {
    return {
      type: "resetCriteria",
      targetName: criterion.name,
      criterionNames: model.criteria.map((item) => item.name),
    };
  }

  return null;
}

function applyPendingAssistantAction(action: PendingAssistantAction, model: DecisionModel) {
  if (action.type === "removeSubcriteria") {
    const parent = findCriterion(model.criteria, action.parentId);
    if (!parent) return { model, reply: "Não encontrei mais esse critério para confirmar a remoção." };
    return {
      model: {
        ...model,
        criteria: updateCriterion(model.criteria, action.parentId, (criterion) => ({
          ...criterion,
          children: undefined,
          scale: { min: 0, max: 10, direction: "benefit", mode: "quantitative" },
          performances: Object.fromEntries(model.alternatives.map((alternative) => [alternative.id, ""])),
        })),
      },
      reply: `Removi os subcritérios de ${action.parentName} (${action.childNames.join(" e ")}) e transformei ${action.parentName} em folha.`,
      selectedId: action.parentId,
    };
  }

  const first = createCriterion("Critério 1", 50, model.alternatives);
  const second = createCriterion("Critério 2", 50, model.alternatives);
  return {
    model: { ...model, criteria: [first, second] },
    reply: `Removi os critérios principais (${action.criterionNames.join(" e ")}) e reiniciei a estrutura de critérios.`,
    selectedId: ROOT_ID,
  };
}

function pendingAssistantActionPrompt(action: PendingAssistantAction) {
  if (action.type === "removeSubcriteria") {
    return `Não removi ${action.targetName}, porque ${action.parentName} ficaria com apenas um subcritério. Cada critério composto precisa ter no mínimo 2 subcritérios. Posso remover os dois subcritérios de ${action.parentName} (${action.childNames.join(" e ")}) e transformar ${action.parentName} em folha?`;
  }

  return `Não removi ${action.targetName}, porque a árvore ficaria com apenas um critério principal. A raiz precisa ter no mínimo 2 critérios. Posso remover os critérios principais (${action.criterionNames.join(" e ")}) e reiniciar a estrutura?`;
}

function applyAssistantClause(
  rawClause: string,
  model: DecisionModel,
  setNotice: (text: string) => void,
): { model: DecisionModel; reply: string; selectedId?: string } | undefined {
  const clause = rawClause.trim();
  const text = normalizeText(clause);
  if (!clause || text.length < 3) return undefined;
  if (isStructuredDescription(text)) return undefined;

  const addNamedChildMatch = clause.match(
    /(?:adicione|adicionar|inclua|incluir|crie|criar)\s+(?:o\s+|a\s+|um\s+|uma\s+|os\s+|as\s+)?(?:(?:crit[eé]rio|subcrit[eé]rio)s?\s+)?(.+?)\s+(?:em|no|na|ao|a|para)\s+(?:o\s+|a\s+)?(?:(?:crit[eé]rio)\s+)?(.+)$/i,
  );
  if (addNamedChildMatch) {
    const names = parseNameList(addNamedChildMatch[1]);
    const target = addNamedChildMatch[2];
    if (names.length === 0) return undefined;
    if (isRootTarget(target, model.rootName)) {
      const additions = names.map((name) => createCriterion(name, 20, model.alternatives));
      return {
        model: {
          ...model,
          criteria: additions.reduce((items, criterion) => addWeightedSibling(items, criterion, criterion.weight), model.criteria),
        },
        reply: `Criei ${additions.map((item) => item.name).join(", ")} como critério principal.`,
        selectedId: additions[0]?.id,
      };
    }
    const parent = findCriterionByName(model.criteria, target);
    if (!parent) return { model, reply: "Não encontrei o critério que receberia esse subcritério." };
    const next = addSubcriteriaToModel(model, parent.id, names);
    return {
      model: next,
      reply: `Adicionei ${names.join(", ")} em ${parent.name}.`,
      selectedId: parent.id,
    };
  }

  const namedSubcriterionMatch = text.match(
    /(?:adicione|adicionar|inclua|incluir|crie|criar)\s+(?:um\s+|uma\s+|o\s+|a\s+)?subcriterio\s+(?:em|no|na|ao|a|para)\s+(?:criterio\s+)?(.+?)\s+chamad[oa]\s+(.+)/,
  );
  if (namedSubcriterionMatch) {
    const parent = findCriterionByName(model.criteria, namedSubcriterionMatch[1]);
    const names = parseNameList(namedSubcriterionMatch[2]);
    if (!parent) return { model, reply: "Não encontrei o critério que receberia esse subcritério." };
    if (names.length === 0) return undefined;
    const next = addSubcriteriaToModel(model, parent.id, names);
    return {
      model: next,
      reply: `Adicionei ${names.join(", ")} em ${parent.name}.`,
      selectedId: parent.id,
    };
  }

  const addSubcriteriaMatch = clause.match(
    /(?:adicione|adicionar|inclua|incluir|crie|criar)\s+(?:os?\s+)?subcrit[eé]rios?\s+(.+?)\s+(?:ao|a|no|na|em|para\s+o|para\s+a)\s+(?:crit[eé]rio\s+)?(.+)/i,
  );
  if (addSubcriteriaMatch) {
    const names = parseNameList(addSubcriteriaMatch[1]);
    const parent = findCriterionByName(model.criteria, addSubcriteriaMatch[2]);
    if (!parent) return { model, reply: "Não encontrei o critério que receberia esses subcritérios." };
    const children = names.map((name, index) => createCriterion(name, 100 / Math.max(1, names.length), model.alternatives));
    const next = {
      ...model,
      criteria: updateCriterion(model.criteria, parent.id, (criterion) => ({
        ...criterion,
        children: normalizeSiblings([...(criterion.children ?? []), ...children]),
        scale: undefined,
        performances: undefined,
      })),
    };
    return {
      model: next,
      reply: `Adicionei ${names.length} subcritério${names.length === 1 ? "" : "s"} em ${parent.name}.`,
      selectedId: parent.id,
    };
  }

  const removeAlternativeMatch = text.match(
    /(?:remova|remover|apague|apagar|exclua|excluir|delete)\s+(?:as?\s+)?alternativas?\s+(.+)/,
  );
  const genericRemoveMatch = text.match(/^(?:remova|remover|apague|apagar|exclua|excluir|delete)\s+(.+)$/);
  if (removeAlternativeMatch || genericRemoveMatch) {
    const target = removeAlternativeMatch?.[1] ?? genericRemoveMatch?.[1] ?? "";
    const alternative = findAlternativeByName(model.alternatives, target);
    if (alternative) {
      return {
        model: removeAlternativeFromModel(model, alternative.id),
        reply: `Removi ${alternative.name} da avaliacao.`,
      };
    }
    if (removeAlternativeMatch) return undefined;
  }

  const addAlternativeMatch = text.match(
    /(?:adicione|adicionar|inclua|incluir|crie|criar)\s+(?:as?\s+)?alternativas?\s+(.+)/,
  );
  if (addAlternativeMatch) {
    const names = parseNameList(removeTrailingCommand(addAlternativeMatch[1]));
    if (names.length === 0) return undefined;
    const existing = model.alternatives.map((item) => normalizeText(item.name));
    const additions = names
      .filter((name) => !existing.includes(normalizeText(name)))
      .map((name) => ({ id: uid("alt"), name }));
    if (additions.length === 0) return { model, reply: "Essas alternativas ja existem no modelo." };
    return {
      model: { ...model, alternatives: [...model.alternatives, ...additions] },
      reply: `Adicionei ${additions.map((item) => item.name).join(", ")} como alternativa${additions.length === 1 ? "" : "s"}.`,
    };
  }

  const removeCriterionMatch = text.match(/(?:remova|remover|apague|apagar|exclua|excluir|delete)\s+(?:o\s+)?criterio\s+(.+)/);
  const genericCriterionRemoveTarget = genericRemoveMatch ? removeTrailingCommand(genericRemoveMatch[1]) : "";
  if (removeCriterionMatch || genericCriterionRemoveTarget) {
    const criterion = findCriterionByName(
      model.criteria,
      removeCriterionMatch ? removeTrailingCommand(removeCriterionMatch[1]) : genericCriterionRemoveTarget,
    );
    if (!criterion) return { model, reply: "Não encontrei esse critério. Tente usar o nome exibido no nó." };
    const parent = findParent(model.criteria, criterion.id);
    const canRemove = parent ? (parent.children?.length ?? 0) > 2 : model.criteria.length > 2;
    if (!canRemove) {
      const reply = buildBlockedCriterionRemovalMessage(criterion, parent, model.criteria);
      setNotice(reply);
      return { model, reply };
    }
    return {
      model: { ...model, criteria: normalizeTreeAfterRemoval(removeCriterion(model.criteria, criterion.id)) },
      reply: `Removi o critério ${criterion.name} e normalizei os pesos restantes.`,
      selectedId: parent?.id ?? ROOT_ID,
    };
  }

  const addCriterionMatch = text.match(/(?:adicione|adicionar|inclua|incluir|crie|criar)\s+(?:os?\s+)?criterios?\s+(.+)/);
  if (addCriterionMatch) {
    const source = removeTrailingCommand(addCriterionMatch[1]);
    const childrenMatch = source.match(/(.+?)\s+com\s+(?:os?\s+)?subcriterios?\s+(.+)/);
    const parentName = childrenMatch ? cleanName(childrenMatch[1]) : undefined;
    const names = childrenMatch && parentName ? [parentName] : parseWeightedItems(source).map((item) => item.name);
    const weight = parseFirstNumber(source) ?? 20;
    if (names.length === 0) return undefined;
    const criteria = names.map((name) => {
      if (!childrenMatch) return createCriterion(name, weight, model.alternatives);
      const children = parseNameList(childrenMatch[2] ?? "").map((child) => createCriterion(child, 50, model.alternatives));
      return createCriterion(name, weight, model.alternatives, normalizeSiblings(children));
    });
    const nextCriteria = criteria.reduce(
      (items, criterion) => addWeightedSibling(items, criterion, criterion.weight),
      model.criteria,
    );
    return {
      model: { ...model, criteria: nextCriteria },
      reply: `Criei ${criteria.map((item) => item.name).join(", ")} como critério${criteria.length === 1 ? "" : "s"} raiz.`,
      selectedId: criteria[0]?.id,
    };
  }

  const weightBatchMatch = text.match(
    /peso\s+dos\s+criterios\s+(.+?)\s+(?:para|=|em)\s+(.+?)\s*%?$/,
  );
  if (weightBatchMatch) {
    const names = parseNameList(weightBatchMatch[1]);
    const weights = parseNumberList(weightBatchMatch[2]);
    if (names.length === 0 || weights.length === 0) return undefined;
    if (names.length !== weights.length) {
      return { model, reply: "Informe a mesma quantidade de criterios e pesos. Ex: Peso dos criterios Custo, Qualidade para 40, 60%." };
    }

    const criteria = names.map((name) => findCriterionByName(model.criteria, name));
    if (criteria.some((criterion) => !criterion)) {
      return { model, reply: "Nao encontrei todos os criterios informados para ajustar os pesos." };
    }

    const foundCriteria = criteria as Criterion[];
    const parentIds = foundCriteria.map((criterion) => findParent(model.criteria, criterion.id)?.id ?? ROOT_ID);
    const parentId = parentIds[0];
    if (!parentIds.every((id) => id === parentId)) {
      return { model, reply: "Defina pesos em lote apenas para criterios irmaos, ou seja, dentro do mesmo criterio pai." };
    }

    const informedSiblingWeightSum = weights.reduce((sum, weight) => sum + weight, 0);
    if (informedSiblingWeightSum > 100) {
      return {
        model,
        reply: `Pesos invalidos: os criterios informados sao irmaos e seus pesos somam ${formatWeight(informedSiblingWeightSum)}%, acima de 100%.`,
      };
    }

    const weightsById = new Map(foundCriteria.map((criterion, index) => [criterion.id, weights[index]]));
    const next =
      parentId === ROOT_ID
        ? { ...model, criteria: setSiblingWeights(model.criteria, weightsById) }
        : {
            ...model,
            criteria: updateCriterion(model.criteria, parentId, (parent) => ({
              ...parent,
              children: setSiblingWeights(parent.children ?? [], weightsById),
            })),
          };

    return {
      model: next,
      reply: `Defini os pesos de ${foundCriteria.map((criterion, index) => `${criterion.name} (${formatWeight(weights[index])}%)`).join(", ")}.`,
      selectedId: parentId,
    };
  }

  const weightMatch = text.match(
    /peso\s+(?:do|da|de|dos|das)?\s*(?:criterio\s+)?(.+?)\s+(?:para|=|em)\s+(\d+(?:[,.]\d+)?)\s*%?/,
  );
  if (weightMatch) {
    const criterion = findCriterionByName(model.criteria, weightMatch[1]);
    if (!criterion) return { model, reply: "Não encontrei esse critério para alterar o peso." };
    const weight = Number(weightMatch[2].replace(",", "."));
    if (weight > 100) return { model, reply: `Peso invalido: ${formatWeight(weight)}% esta acima de 100%.` };
    const parent = findParent(model.criteria, criterion.id);
    const next = !parent
      ? { ...model, criteria: normalizeSiblings(model.criteria, criterion.id, weight) }
      : {
          ...model,
          criteria: updateCriterion(model.criteria, parent.id, (item) => ({
            ...item,
            children: normalizeSiblings(item.children ?? [], criterion.id, weight),
          })),
        };
    return {
      model: next,
      reply: `Atualizei ${criterion.name} para ${formatWeight(weight)}% e redistribuí os irmãos para soma 100%.`,
      selectedId: parent?.id ?? ROOT_ID,
    };
  }

  const performanceMatch = clause.match(
    /(?:defina|definir|configure|configurar|ajuste|ajustar|informe|informar|coloque|colocar)\s+(?:o\s+|a\s+)?(.+?)\s+(?:do|da|de|para|em)\s+(.+?)\s+(?:como|=|para|em)\s+(.+)$/i,
  );
  if (performanceMatch) {
    const criterion = findCriterionByName(model.criteria, performanceMatch[1]);
    const alternative = findAlternativeByName(model.alternatives, performanceMatch[2]);
    if (!criterion || !alternative || !isLeaf(criterion)) {
      return { model, reply: "Não encontrei uma folha e uma alternativa compatíveis para preencher esse desempenho." };
    }
    const rawValue = cleanPerformanceValue(performanceMatch[3]);
    const value = parsePerformanceValue(rawValue);
    if (value === undefined) return { model, reply: "Não consegui identificar o valor de desempenho informado." };
    return {
      model: {
        ...model,
        criteria: updateCriterion(model.criteria, criterion.id, (item) => {
          const normalizedValue = normalizePerformanceForScale(item, value);
          return {
            ...item,
            performances: { ...(item.performances ?? {}), [alternative.id]: normalizedValue },
          };
        }),
      },
      reply: `Defini ${criterion.name} de ${alternative.name} como ${rawValue}.`,
      selectedId: criterion.id,
    };
  }

  const valueCurveMatch = clause.match(/curva\s+de\s+valor\s+de\s+(.+?)\s*:\s*(.+)$/i);
  if (valueCurveMatch) {
    const criterion = findCriterionByName(model.criteria, valueCurveMatch[1]);
    if (!criterion) return { model, reply: "Nao encontrei esse criterio para configurar a curva de valor." };
    if (!isLeaf(criterion)) {
      return { model, reply: `${criterion.name} e um criterio composto. A curva de valor so pode ser definida em criterios folha.` };
    }

    const valuePoints = parseValueCurvePoints(valueCurveMatch[2]);
    if (valuePoints.length < 2) {
      return { model, reply: "Informe pelo menos dois pontos no formato valor - score. Ex: Curva de valor de Preco: 0 - 0, 10 - 100." };
    }

    const min = Math.min(...valuePoints.map((point) => point.value));
    const max = Math.max(...valuePoints.map((point) => point.value));
    return {
      model: {
        ...model,
        criteria: updateCriterion(model.criteria, criterion.id, (item) => ({
          ...item,
          scale: {
            min,
            max,
            direction: "benefit",
            mode: "quantitative",
            autoBounds: false,
            manualCurve: true,
            valuePoints,
          },
        })),
      },
      reply: `Configurei a curva de valor de ${criterion.name} com ${valuePoints.length} pontos.`,
      selectedId: criterion.id,
    };
  }

  const scaleMatch = clause.match(
    /(?:defina|definir|configure|configurar|ajuste|ajustar)\s+(?:a\s+|o\s+)?(?:(?:escala|curva|fun[çc][aã]o(?:\s+de\s+valor)?)\s+(?:do|da|de)\s+)?(?:crit[eé]rio\s+)?(.+?)\s+de\s+(\d+(?:[,.]\d+)?)\s+a\s+(\d+(?:[,.]\d+)?)(.*)$/i,
  );
  if (scaleMatch) {
    const criterion = findCriterionByName(model.criteria, scaleMatch[1]);
    if (!criterion || !isLeaf(criterion)) return { model, reply: "Não encontrei uma folha compatível para configurar a curva." };
    const min = Number(scaleMatch[2].replace(",", "."));
    const max = Number(scaleMatch[3].replace(",", "."));
    const tail = normalizeText(scaleMatch[4]);
    const direction: Direction = tail.includes("menor") || tail.includes("custo") ? "cost" : "benefit";
    return {
      model: {
        ...model,
        criteria: updateCriterion(model.criteria, criterion.id, (item) => ({
          ...item,
          scale: { min, max, direction, mode: "quantitative", autoBounds: false },
        })),
      },
      reply: `Configurei a curva de ${criterion.name}: ${min} a ${max}, ${direction === "cost" ? "menor e melhor" : "maior e melhor"}.`,
      selectedId: criterion.id,
    };
  }

  return undefined;
}

function interpretStructuredDescription(rawText: string, model: DecisionModel) {
  if (!isStructuredDescription(normalizeText(rawText))) return { model, replies: [] as string[] };

  let draft = model;
  const replies: string[] = [];
  const rootName = extractFirst(rawText, [
    /(?:problema central|objetivo|decis[aã]o)\s*(?:e|é|eh|:|ser[aá]|sera)?\s+([\s\S]+?)(?=,?\s+(?:onde|com|terei|e\s+(?:terei|os|as)|crit[eé]rios?|alternativas?)|[.;\n]|$)/i,
  ]);
  const alternativesText = extractFirst(rawText, [
    /(?:as\s+)?alternativas?\s*(?:s[aã]o|ser[aã]o|:)\s+([\s\S]+?)(?=,?\s+(?:e\s+o\s+problema|e\s+a\s+decis[aã]o|onde|com\s+os\s+crit[eé]rios|terei\s+os\s+crit[eé]rios|os\s+crit[eé]rios|crit[eé]rios?\s*(?:s[aã]o|:))|[.;\n]|$)/i,
  ]);
  const criteriaText = extractFirst(rawText, [
    /(?:terei\s+os\s+|com\s+os\s+|os\s+|meus\s+)?crit[eé]rios?\s*(?:s[aã]o|ser[aã]o|:)?\s+([\s\S]+?)(?=,?\s+(?:com\s+os\s+subcrit[eé]rios|subcrit[eé]rios|e\s+os\s+subcrit[eé]rios|alternativas?|problema central)|[.;\n]|$)/i,
  ]);

  if (rootName) {
    draft = { ...draft, rootName: cleanName(rootName) };
    replies.push(`Atualizei o problema central para "${draft.rootName}".`);
  }

  if (alternativesText) {
    const alternatives = parseNameList(alternativesText).map((name) => ({ id: uid("alt"), name }));
    if (alternatives.length > 0) {
      draft = { ...draft, alternatives };
      replies.push(`Substitui as alternativas por ${alternatives.map((item) => item.name).join(", ")}.`);
    }
  }

  if (criteriaText) {
    const weightedItems = parseWeightedItems(criteriaText);
    if (weightedItems.length > 0) {
      const criteria = weightedItems.map((item) => createCriterion(item.name, item.weight ?? 100 / weightedItems.length, draft.alternatives));
      draft = { ...draft, criteria: normalizeSiblings(criteria) };
      replies.push(`Montei os critérios principais: ${criteria.map((item) => item.name).join(", ")}.`);
    }
  }

  const subcriteriaChanges = parseSubcriteriaDescriptions(rawText, draft);
  if (subcriteriaChanges.model !== draft) {
    draft = subcriteriaChanges.model;
    replies.push(...subcriteriaChanges.replies);
  }

  return { model: draft, replies };
}

function parseSubcriteriaDescriptions(rawText: string, model: DecisionModel) {
  let draft = model;
  const replies: string[] = [];
  const explicitPatterns = [
    /crit[eé]rio\s+(.+?)\s+com\s+(?:os?\s+)?subcrit[eé]rios?\s+([\s\S]+?)(?=[.;\n]|$)/gi,
    /subcrit[eé]rios?\s+(?:de|do|da|para|no|na)\s+(?:o\s+|a\s+)?(.+?)\s*(?:s[aã]o|:)?\s+([\s\S]+?)(?=[.;\n]|$)/gi,
  ];

  for (const pattern of explicitPatterns) {
    for (const match of rawText.matchAll(pattern)) {
      const parent = findCriterionByName(draft.criteria, match[1]);
      const names = parseNameList(match[2]);
      if (!parent || names.length === 0) continue;
      draft = addSubcriteriaToModel(draft, parent.id, names);
      replies.push(`Adicionei subcritérios em ${parent.name}: ${names.join(", ")}.`);
    }
  }

  const global = rawText.match(/com\s+(?:os?\s+)?subcrit[eé]rios?\s+([\s\S]+?)(?=[.;\n]|$)/i);
  if (global && flattenCriteria(draft.criteria).length === 1) {
    const parent = draft.criteria[0];
    const names = parseNameList(global[1]);
    if (names.length > 0) {
      draft = addSubcriteriaToModel(draft, parent.id, names);
      replies.push(`Adicionei subcritérios em ${parent.name}: ${names.join(", ")}.`);
    }
  }

  return { model: draft, replies };
}

function addSubcriteriaToModel(model: DecisionModel, parentId: string, names: string[]) {
  const children = names.map((name) => createCriterion(name, 100 / names.length, model.alternatives));
  return {
    ...model,
    criteria: updateCriterion(model.criteria, parentId, (criterion) => ({
      ...criterion,
      children: normalizeSiblings([
        ...(criterion.children ?? []),
        ...children,
        ...((criterion.children?.length ?? 0) === 0 && children.length === 1
          ? [createCriterion("Novo subcritério", 50, model.alternatives)]
          : []),
      ]),
      scale: undefined,
      performances: undefined,
    })),
  };
}

function buildCriteriaFromAgentItems(
  items: Array<{ name?: string; weight?: number; subcriteria?: string[] }>,
  alternatives: Alternative[],
) {
  return items
    .map((item) => {
      const name = cleanName(item.name ?? "");
      if (!name) return undefined;
      const subcriteria = uniqueNames(item.subcriteria ?? []);
      const children =
        subcriteria.length > 0
          ? normalizeSiblings(subcriteria.map((child) => createCriterion(child, 100 / subcriteria.length, alternatives)))
          : undefined;
      return createCriterion(name, clamp(Number(item.weight ?? 20), 0, 100), alternatives, children);
    })
    .filter((criterion): criterion is Criterion => Boolean(criterion));
}

function splitAssistantClauses(rawText: string) {
  return rawText
    .split(
      /[\n.;]+|,\s*(?=(?:adicione|adicionar|inclua|incluir|crie|criar|remova|remover|apague|apagar|exclua|excluir|delete|mude|mudar|altere|alterar|troque|trocar|peso|defina|definir|configure|configurar|ajuste|ajustar)\b)|\s+e\s+(?=(?:adicione|adicionar|inclua|incluir|crie|criar|remova|remover|apague|apagar|exclua|excluir|delete|mude|mudar|altere|alterar|troque|trocar|peso|defina|definir|configure|configurar|ajuste|ajustar)\b)/i,
    )
    .map((item) => item.trim())
    .filter(Boolean);
}

function isStructuredDescription(text: string) {
  return (
    /problema central|objetivo/.test(text) ||
    /alternativas?\s+(?:sao|serao|:)/.test(text) ||
    /(?:terei|com|os|meus)\s+os?\s+criterios?/.test(text) ||
    /criterios?\s+(?:sao|serao|:)/.test(text)
  );
}

function createCriterion(name: string, weight: number, alternatives: Alternative[], children?: Criterion[]): Criterion {
  const hasChildren = (children?.length ?? 0) > 0;
  return {
    id: uid("crit"),
    name,
    weight,
    children: hasChildren ? children : undefined,
    scale: undefined,
    performances: hasChildren ? undefined : Object.fromEntries(alternatives.map((alternative) => [alternative.id, ""])),
  };
}

function removeAlternativeFromModel(model: DecisionModel, id: string) {
  return {
    ...model,
    alternatives: model.alternatives.filter((item) => item.id !== id),
    criteria: updateAllLeaves(model.criteria, (criterion) => {
      const performances = { ...(criterion.performances ?? {}) };
      delete performances[id];
      return { ...criterion, performances };
    }),
  };
}

function findAlternativeByName(alternatives: Alternative[], name: string) {
  const target = normalizeText(cleanName(name));
  return (
    alternatives.find((item) => normalizeText(item.name) === target) ??
    alternatives.find((item) => normalizeText(item.name).includes(target) || target.includes(normalizeText(item.name)))
  );
}

function findCriterionByName(criteria: Criterion[], name: string) {
  const target = normalizeText(cleanName(name));
  return (
    flattenCriteria(criteria).find((item) => normalizeText(item.name) === target) ??
    flattenCriteria(criteria).find((item) => normalizeText(item.name).includes(target) || target.includes(normalizeText(item.name)))
  );
}

function parseWeightedItems(value: string) {
  return parseNameList(value).map((item) => {
    const weight = parseFirstNumber(item);
    return {
      name: cleanName(item.replace(/\b(?:peso|com\s+peso|ponderacao)\b/gi, "").replace(/\d+(?:[,.]\d+)?\s*%?/g, "")),
      weight,
    };
  }).filter((item) => item.name);
}

function parseNameList(value: string) {
  return removeTrailingCommand(value)
    .replace(/\s+(?:e|ou)\s+/gi, ",")
    .split(/[,;]+/)
    .map(cleanName)
    .filter(Boolean);
}

function parseNumberList(value: string) {
  return value
    .replace(/\s+(?:e|ou)\s+/gi, ",")
    .split(/[,;]+/)
    .map((item) => Number(item.replace("%", "").replace(",", ".").trim()))
    .filter(Number.isFinite);
}

function parseValueCurvePoints(value: string): ValuePoint[] {
  return value
    .split(/[,;]+/)
    .map((item) => {
      const match = item.match(/(-?\d+(?:[,.]\d+)?)\s*(?:-|->|:)\s*(-?\d+(?:[,.]\d+)?)\s*%?/);
      if (!match) return undefined;
      const pointValue = Number(match[1].replace(",", "."));
      const score = Number(match[2].replace(",", "."));
      if (!Number.isFinite(pointValue) || !Number.isFinite(score)) return undefined;
      return {
        id: uid("point"),
        value: pointValue,
        score: clamp(score, 0, 100),
      };
    })
    .filter((point): point is ValuePoint => Boolean(point))
    .sort((a, b) => a.value - b.value);
}

function uniqueNames(values: string[]) {
  const seen = new Set<string>();
  return values
    .map(cleanName)
    .filter((name) => {
      const key = normalizeText(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cleanName(value: string) {
  const compact = value.replace(/\[[^\]]*\]/g, "").replace(/[:.]+$/g, "").trim();
  if (/^[\p{L}\p{N}]$/u.test(compact)) return compact.toUpperCase();

  return titleCase(
    compact
      .replace(
        /(^|\s)(?:o|a|os|as|um|uma|criterio|criterios|critério|critérios|alternativa|alternativas|subcriterio|subcriterios|subcritério|subcritérios)(?=\s|$)/gi,
        " ",
      )
      .replace(/\b(?:sao|são|serao|serão|sera|será|eh|e|é|com|peso|para|ao|no|na|do|da|de)\b$/gi, "")
      .trim(),
  );
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function parseFirstNumber(value: string) {
  const match = value.match(/(\d+(?:[,.]\d+)?)\s*%?/);
  return match ? Number(match[1].replace(",", ".")) : undefined;
}

function cleanPerformanceValue(value: string) {
  return value.replace(/[.;]+$/g, "").trim();
}

function parsePerformanceValue(value: string) {
  const numeric = value.match(/^-?\d+(?:[,.]\d+)?$/);
  if (numeric) return Number(value.replace(",", "."));
  const text = cleanName(value);
  return text || undefined;
}

function removeTrailingCommand(value: string) {
  return value.replace(
    /\s+(?:e\s+)?(?:adicione|adicionar|inclua|incluir|crie|criar|remova|remover|apague|apagar|exclua|excluir|delete|mude|mudar|altere|alterar|troque|trocar|peso|defina|definir|configure|configurar|ajuste|ajustar)\b[\s\S]*$/i,
    "",
  );
}

function extractFirst(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && ["de", "da", "do", "das", "dos", "e"].includes(lower)) return lower;
      if (/[A-Z]{2,}|\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function CriterionInspector({
  activeStep,
  step1Phase,
  selectedId,
  criterion,
  children,
  alternatives,
  canDelete,
  notice,
  criterionConfigured,
  currentWeightNodeId,
  weightResetMode,
  rootName,
  onChange,
  onRootNameChange,
  onSiblingWeightChange,
  onDelete,
  onAddChildren,
  onConvertToLeaf,
  onMarkCriterionConfigured,
  onMarkWeightsReady,
  onPerformanceChange,
}: {
  activeStep: MavtStep;
  step1Phase: Step1Phase;
  selectedId: string;
  criterion?: Criterion;
  children: Criterion[];
  alternatives: Alternative[];
  canDelete: boolean;
  notice: string;
  criterionConfigured: boolean;
  currentWeightNodeId?: string;
  weightResetMode: boolean;
  rootName: string;
  onChange: (updater: (criterion: Criterion) => Criterion) => void;
  onRootNameChange: (rootName: string) => void;
  onSiblingWeightChange: (childId: string, weight: number) => void;
  onDelete: () => void;
  onAddChildren: (names: string[]) => void;
  onConvertToLeaf: () => void;
  onMarkCriterionConfigured: () => void;
  onMarkWeightsReady: () => void;
  onPerformanceChange: (alternativeId: string, value: number | string) => void;
}) {
  const [childDraft, setChildDraft] = useState("");
  const isRoot = selectedId === ROOT_ID;
  const leaf = criterion ? isLeaf(criterion) : false;
  const showStructureEditor = activeStep === 1 && step1Phase === "structure";
  const showLeafConfiguration = activeStep === 1 && step1Phase === "configure";
  const showWeightEditor = activeStep === 3 && (weightResetMode ? children.length > 0 : selectedId === currentWeightNodeId);
  const scale = criterion?.scale ?? { min: 0, max: 10, direction: "benefit" as Direction, autoBounds: false };
  const scaleMode = scale.mode ?? "quantitative";
  const quantitativeBounds = criterion ? getQuantitativeBounds(criterion) : { min: scale.min, max: scale.max };
  const displayedMin = scale.autoBounds === true ? quantitativeBounds.min : scale.min;
  const displayedMax = scale.autoBounds === true ? quantitativeBounds.max : scale.max;
  const valuePoints = scale.valuePoints ?? [];
  const qualitativeOptions = scale.qualitativeOptions ?? [
    { id: "qual-ruim", label: "Ruim", score: 0 },
    { id: "qual-medio", label: "Medio", score: 50 },
    { id: "qual-bom", label: "Bom", score: 100 },
  ];
  const submitChildDraft = () => {
    const names = parseNameList(childDraft);
    if (names.length === 0) return;
    onAddChildren(names);
    setChildDraft("");
  };

  return (
    <div className="inspector-content">
      {notice && <div className="notice">{notice}</div>}

      {showStructureEditor && isRoot && (
        <label className="field">
          Nome
          <input value={rootName} onChange={(event) => onRootNameChange(event.target.value)} />
        </label>
      )}

      {showStructureEditor && !isRoot && criterion && (
        <label className="field">
          Nome
          <input value={criterion.name} onChange={(event) => onChange((item) => ({ ...item, name: event.target.value }))} />
        </label>
      )}

      {showStructureEditor && (
        <div className="child-builder">
          <div>
            <div className="section-title">{isRoot ? "Critérios principais" : "Subcritérios"}</div>
            <p className="helper-text">Digite um ou mais nomes separados por vírgula.</p>
          </div>
          <div className="child-builder-row">
            <input
              value={childDraft}
              onChange={(event) => setChildDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitChildDraft();
                }
              }}
              placeholder={isRoot ? "Ex: Custo, Qualidade" : "Ex: Preço, Manutenção"}
            />
            <button onClick={submitChildDraft}>
              <Plus size={16} />
              Adicionar
            </button>
          </div>
        </div>
      )}

      {showWeightEditor && !leaf && (
        <div className="weight-editor">
          <div className="section-title">Pesos dos filhos</div>
          <p className="helper-text">Ajuste um peso e os irmãos serão redistribuídos automaticamente.</p>

          {children.map((child) => (
            <div className="weight-row" key={child.id}>
              <div>
                <strong>{child.name}</strong>
                <span>{isLeaf(child) ? "Folha de valor" : "Critério composto"}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="0.01"
                value={child.weight}
                onChange={(event) => onSiblingWeightChange(child.id, Number(event.target.value))}
              />
              <WeightInput value={child.weight} onChange={(value) => onSiblingWeightChange(child.id, value)} />
            </div>
          ))}

          {!weightResetMode && (
            <div className="button-row">
              <button className="primary" onClick={onMarkWeightsReady}>
                Pronto
              </button>
            </div>
          )}
        </div>
      )}

      {showLeafConfiguration && leaf && criterion && (
        <div className="leaf-editor">
          <div className={`readonly-weight ${criterionConfigured ? "ready" : ""}`}>
            Configuração: <strong>{criterionConfigured ? "pronta" : "pendente"}</strong>
          </div>
          <label className="field">
            Nome
            <input value={criterion.name} onChange={(event) => onChange((item) => ({ ...item, name: event.target.value }))} />
          </label>
          <div className="section-title">Função de valor</div>
          <label className="field">
            Tipo de métrica
            <select
              value={scaleMode}
              onChange={(event) => {
                const mode = event.target.value as ScaleMode;
                onChange((item) => ({
                  ...item,
                  scale:
                    mode === "qualitative"
                      ? {
                          ...scale,
                          mode,
                          min: 0,
                          max: 100,
                          direction: "benefit",
                          qualitativeOptions,
                        }
                      : { ...scale, mode, qualitativeOptions: undefined },
                  performances: {},
                }));
              }}
            >
              <option value="quantitative">Quantitativa</option>
              <option value="qualitative">Qualitativa</option>
            </select>
          </label>

          {scaleMode === "quantitative" && (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={scale.autoBounds === true}
                  onChange={(event) =>
                    onChange((item) => ({
                      ...item,
                      scale: { ...scale, mode: "quantitative", autoBounds: event.target.checked },
                    }))
                  }
                />
                Ajustar mínimo e máximo automaticamente pelos valores das alternativas
              </label>
              <div className="field-grid">
                <label className="field">
                  Mínimo
                  <input
                    type="number"
                    value={displayedMin}
                    disabled={scale.autoBounds === true}
                    onChange={(event) =>
                      onChange((item) => ({
                        ...item,
                        scale: { ...scale, mode: "quantitative", autoBounds: false, min: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  Máximo
                  <input
                    type="number"
                    value={displayedMax}
                    disabled={scale.autoBounds === true}
                    onChange={(event) =>
                      onChange((item) => ({
                        ...item,
                        scale: { ...scale, mode: "quantitative", autoBounds: false, max: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
              </div>
              <label className="field">
                Direção
                <select
                  value={scale.manualCurve === true ? "manual" : scale.direction}
                  onChange={(event) => {
                    const direction = event.target.value as QuantitativeDirection;
                    onChange((item) => ({
                      ...item,
                      scale: {
                        ...scale,
                        mode: "quantitative",
                        direction: direction === "manual" ? "benefit" : direction,
                        manualCurve: direction === "manual",
                        valuePoints:
                          direction === "manual" && valuePoints.length === 0
                            ? [
                                { id: uid("point"), value: quantitativeBounds.min, score: 0 },
                                { id: uid("point"), value: quantitativeBounds.max, score: 100 },
                              ]
                            : valuePoints,
                      },
                    }));
                  }}
                >
                  <option value="benefit">Maior e melhor</option>
                  <option value="cost">Menor e melhor</option>
                  <option value="manual">Curva manual</option>
                </select>
              </label>
              {scale.manualCurve === true && (
                <div className="curve-editor">
                  <p className="helper-text">O score será interpolado entre os pontos definidos.</p>
                  {valuePoints.map((point) => (
                    <div className="qualitative-row" key={point.id}>
                      <input
                        type="number"
                        value={point.value}
                        onChange={(event) =>
                          onChange((item) => ({
                            ...item,
                            scale: {
                              ...scale,
                              mode: "quantitative",
                              manualCurve: true,
                              valuePoints: valuePoints.map((current) =>
                                current.id === point.id ? { ...current, value: Number(event.target.value) } : current,
                              ),
                            },
                          }))
                        }
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={point.score}
                        onChange={(event) =>
                          onChange((item) => ({
                            ...item,
                            scale: {
                              ...scale,
                              mode: "quantitative",
                              manualCurve: true,
                              valuePoints: valuePoints.map((current) =>
                                current.id === point.id ? { ...current, score: Number(event.target.value) } : current,
                              ),
                            },
                          }))
                        }
                      />
                      <button
                        className="icon-button danger-text"
                        onClick={() =>
                          onChange((item) => ({
                            ...item,
                            scale: {
                              ...scale,
                              mode: "quantitative",
                              manualCurve: true,
                              valuePoints: valuePoints.filter((current) => current.id !== point.id),
                            },
                          }))
                        }
                        aria-label="Remover ponto"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <div className="button-row">
                    <button
                      onClick={() =>
                        onChange((item) => ({
                          ...item,
                          scale: {
                            ...scale,
                            mode: "quantitative",
                            manualCurve: true,
                            valuePoints: [
                              ...valuePoints,
                              { id: uid("point"), value: quantitativeBounds.min, score: 0 },
                            ],
                          },
                        }))
                      }
                    >
                      <Plus size={16} />
                      Ponto
                    </button>
                    <button
                      onClick={() =>
                        onChange((item) => ({
                          ...item,
                          scale: {
                            ...scale,
                            mode: "quantitative",
                            manualCurve: true,
                            valuePoints: [
                              { id: uid("point"), value: quantitativeBounds.min, score: 0 },
                              { id: uid("point"), value: quantitativeBounds.max, score: 100 },
                            ],
                          },
                        }))
                      }
                    >
                      Usar min/max
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {scaleMode === "qualitative" && (
            <div className="qualitative-editor">
              <div className="section-title">Opções qualitativas</div>
              {qualitativeOptions.map((option) => (
                <div className="qualitative-row" key={option.id}>
                  <input
                    value={option.label}
                    onChange={(event) =>
                      onChange((item) => ({
                        ...item,
                        scale: {
                          ...scale,
                          mode: "qualitative",
                          qualitativeOptions: qualitativeOptions.map((current) =>
                            current.id === option.id ? { ...current, label: event.target.value } : current,
                          ),
                        },
                      }))
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={option.score}
                    onChange={(event) =>
                      onChange((item) => ({
                        ...item,
                        scale: {
                          ...scale,
                          mode: "qualitative",
                          qualitativeOptions: qualitativeOptions.map((current) =>
                            current.id === option.id ? { ...current, score: Number(event.target.value) } : current,
                          ),
                        },
                      }))
                    }
                  />
                  <button
                    className="icon-button danger-text"
                    onClick={() =>
                      onChange((item) => ({
                        ...item,
                        scale: {
                          ...scale,
                          mode: "qualitative",
                          qualitativeOptions: qualitativeOptions.filter((current) => current.id !== option.id),
                        },
                      }))
                    }
                    disabled={qualitativeOptions.length <= 2}
                    aria-label="Remover opção"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  onChange((item) => ({
                    ...item,
                    scale: {
                      ...scale,
                      mode: "qualitative",
                      qualitativeOptions: [
                        ...qualitativeOptions,
                        { id: uid("qual"), label: "Nova opção", score: 50 },
                      ],
                    },
                  }))
                }
              >
                <Plus size={16} />
                Opção qualitativa
              </button>
            </div>
          )}

          <button className="primary wide-button" onClick={onMarkCriterionConfigured}>
            Pronto
          </button>
        </div>
      )}

      {showStructureEditor && !isRoot && (
        <div className="inspector-actions">
          {!leaf && (
            <button className="structure-action" onClick={onConvertToLeaf}>
              <ListMinus size={16} />
              Remover subcritérios
            </button>
          )}
          <button className="danger" onClick={onDelete} disabled={!canDelete}>
            <Trash2 size={16} />
            Remover nó
          </button>
        </div>
      )}
    </div>
  );
}

function WeightInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(formatWeight(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatWeight(value));
  }, [focused, value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(formatWeight(value));
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const parsed = parseDecimalInput(next);
        if (parsed !== undefined) onChange(parsed);
      }}
    />
  );
}

function ResultsPanel({
  results,
  leaves,
  sensitivityData,
  sensitivityLeafId,
  onSensitivityChange,
  alternatives,
  onExportPdf,
}: {
  results: ReturnType<typeof calculateResults>;
  leaves: Array<{ criterion: Criterion; weight: number }>;
  sensitivityData: Array<Record<string, string | number>>;
  sensitivityLeafId: string;
  onSensitivityChange: (id: string) => void;
  alternatives: Alternative[];
  onExportPdf: () => void;
}) {
  const [hoveredChart, setHoveredChart] = useState<"score" | "contribution" | "sensitivity" | null>(null);
  const stackedData = results.map((result) => ({
    name: result.name,
    total: result.score,
    ...Object.fromEntries(result.contributions.map((item) => [item.name, item.value])),
  }));

  return (
    <section className="results-panel">
      <div className="panel-heading flush">
        <div>
          <span className="eyebrow">Resultados</span>
          <h2>Análise MAVT</h2>
        </div>
        <div className="results-actions">
          <button onClick={onExportPdf}>
            <Printer size={16} />
            PDF
          </button>
          <BarChart3 size={22} />
        </div>
      </div>

      <div className="winner-strip">
        <span>Melhor alternativa</span>
        <strong>{results[0]?.name ?? "Sem dados"}</strong>
        <b>{formatNumber(results[0]?.score ?? 0)} pts</b>
      </div>

      <div className="chart-card">
        <h3>Pontuação ponderada</h3>
        <ResponsiveContainer width="100%" height={205}>
          <BarChart data={results} onMouseMove={() => setHoveredChart("score")} onMouseLeave={() => setHoveredChart(null)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis domain={[0, 100]} />
            <Tooltip formatter={(value) => formatTooltipNumber(value)} />
            <Bar dataKey="score" radius={[8, 8, 0, 0]}>
              {hoveredChart !== "score" && (
                <LabelList dataKey="score" position="top" formatter={(value: unknown) => formatTooltipNumber(value)} />
              )}
              {results.map((entry, index) => (
                <Cell key={entry.id} fill={colors[index % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Contribuição por critério</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={stackedData} onMouseMove={() => setHoveredChart("contribution")} onMouseLeave={() => setHoveredChart(null)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(value) => formatTooltipNumber(value)} />
            <Legend />
            {leaves.map((leaf, index) => (
              <Bar key={leaf.criterion.id} dataKey={leaf.criterion.name} stackId="a" fill={colors[index % colors.length]}>
                {hoveredChart !== "contribution" && (
                  <LabelList dataKey={leaf.criterion.name} position="center" formatter={(value: unknown) => formatTooltipNumber(value)} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Tabela de desempenho MAVT</h3>
        <div className="result-table-wrap">
          <table className="result-table">
            <thead>
              <tr>
                <th>Alternativa</th>
                <th>Total</th>
                {leaves.map((leaf) => (
                  <th key={leaf.criterion.id}>{leaf.criterion.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>{result.name}</td>
                  <td>{formatNumber(result.score)}</td>
                  {leaves.map((leaf) => {
                    const contribution = result.contributions.find((item) => item.id === leaf.criterion.id);
                    return <td key={leaf.criterion.id}>{formatNumber(contribution?.value ?? 0)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-title-row">
          <h3>Sensibilidade</h3>
          <select value={sensitivityLeafId} onChange={(event) => onSensitivityChange(event.target.value)}>
            {leaves.map((leaf) => (
              <option key={leaf.criterion.id} value={leaf.criterion.id}>
                {leaf.criterion.name}
              </option>
            ))}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={205}>
          <LineChart data={sensitivityData} onMouseMove={() => setHoveredChart("sensitivity")} onMouseLeave={() => setHoveredChart(null)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="ajuste" />
            <YAxis domain={[0, 100]} />
            <Tooltip formatter={(value) => formatTooltipNumber(value)} />
            <Legend />
            {alternatives.map((alternative, index) => (
              <Line
                key={alternative.id}
                dataKey={alternative.name}
                stroke={colors[index % colors.length]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              >
                {hoveredChart !== "sensitivity" && (
                  <LabelList dataKey={alternative.name} position="top" formatter={(value: unknown) => formatTooltipNumber(value)} />
                )}
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function AlternativesModal({
  alternatives,
  onClose,
  onAdd,
  onReady,
  onRemove,
  onRename,
}: {
  alternatives: Alternative[];
  onClose: () => void;
  onAdd: () => void;
  onReady: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  return (
    <Modal title="Alternativas" onClose={onClose}>
      <div className="modal-list">
        {alternatives.map((alternative) => (
          <div className="modal-row" key={alternative.id}>
            <input value={alternative.name} onChange={(event) => onRename(alternative.id, event.target.value)} />
            <button className="icon-button danger-text" onClick={() => onRemove(alternative.id)} aria-label="Remover">
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
      <button className="wide-button" onClick={() => onAdd()}>
        <Plus size={16} />
        Nova alternativa
      </button>
      <button className="primary wide-button modal-ready-button" onClick={onReady}>
        Pronto
      </button>
    </Modal>
  );
}

function MatrixModal({
  alternatives,
  leaves,
  onClose,
  onReady,
  onPerformanceChange,
}: {
  alternatives: Alternative[];
  leaves: Array<{ criterion: Criterion; weight: number }>;
  onClose: () => void;
  onReady: () => void;
  onPerformanceChange: (criterionId: string, alternativeId: string, value: number | string) => void;
}) {
  return (
    <Modal title="Matriz de desempenho" size="matrix" onClose={onClose}>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Alternativa</th>
              {leaves.map((leaf) => (
                <th key={leaf.criterion.id}>{leaf.criterion.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alternatives.map((alternative) => (
              <tr key={alternative.id}>
                <td>{alternative.name}</td>
                {leaves.map((leaf) => (
                  <td key={leaf.criterion.id}>
                    {(leaf.criterion.scale?.mode ?? "quantitative") === "qualitative" ? (
                      <select
                        value={String(leaf.criterion.performances?.[alternative.id] ?? "")}
                        onChange={(event) => onPerformanceChange(leaf.criterion.id, alternative.id, event.target.value)}
                      >
                        <option value="">Selecionar</option>
                        {(leaf.criterion.scale?.qualitativeOptions ?? []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        value={leaf.criterion.performances?.[alternative.id] ?? ""}
                        onChange={(event) =>
                          onPerformanceChange(
                            leaf.criterion.id,
                            alternative.id,
                            event.target.value === "" ? "" : Number(event.target.value),
                          )
                        }
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="primary wide-button modal-ready-button" onClick={onReady}>
        Pronto
      </button>
    </Modal>
  );
}

function HelpPanel({ topic, onTopicChange }: { topic: HelpTopic; onTopicChange: (topic: HelpTopic) => void }) {
  return (
    <div className="help-panel">
      <div className="help-tabs">
        {helpTopics.map((item) => (
          <button
            key={item.id}
            className={topic === item.id ? "selected" : ""}
            onClick={() => onTopicChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="help-content">{renderHelpTopic(topic)}</div>
    </div>
  );
}

function renderHelpTopic(topic: HelpTopic) {
  if (topic === "method") {
    return (
      <>
        <h3>O que é o método MAVT</h3>
        <p>
          MAVT é um método de apoio à decisão multicritério. Ele compara alternativas usando critérios, pesos e
          funções de valor, transformando desempenhos diferentes em uma pontuação comum.
        </p>
        <p>
          A ideia central é separar o julgamento em partes: o que importa, quanto importa e como cada alternativa se
          comporta em cada critério.
        </p>
      </>
    );
  }

  if (topic === "steps") {
    return (
      <>
        <h3>Passo a passo MAVT</h3>
        <ol>
          <li>Etapa 1A: construa a árvore, criando critérios e subcritérios nos nós.</li>
          <li>Etapa 1B: configure os critérios. Edite nomes dos critérios compostos direto no nó; nas folhas, abra a janela para editar nome, métrica, curva de valor e marcar Pronto.</li>
          <li>Etapa 2: defina manualmente as alternativas e complete a matriz de desempenho.</li>
          <li>Etapa 3: defina os pesos em ordem, começando pela raiz e seguindo pelos critérios compostos destacados.</li>
          <li>Etapa 4: abra Resultados para comparar ranking, contribuição e sensibilidade.</li>
        </ol>
        <p>Você pode voltar para etapas anteriores a qualquer momento. O avanço segue a ordem 1, 2, 3 e 4.</p>
      </>
    );
  }

  if (topic === "agent") {
    return (
      <>
        <h3>Agente MAVT</h3>
        <p>O chat fica disponivel apenas nas etapas 1 e 3, com prompts especificos para cada uma delas.</p>
        <p>
          O chat ajuda principalmente na estrutura dos critérios e nos pesos. Quando a IA externa falha, o app tenta
          aplicar comandos comuns com o agente local.
        </p>
        <ul>
          <li>adicione critério Risco</li>
          <li>adicione Prazo em Qualidade</li>
          <li>adicione subcritério Design em Qualidade</li>
          <li>peso do critério Qualidade para 40%</li>
          <li>configure preço de 0 a 200 menor é melhor</li>
          <li>configure conforto de 0 a 10 maior é melhor</li>
        </ul>
        <p>
          Se uma remoção deixaria um critério com apenas um filho, o agente pergunta antes de remover todos os
          subcritérios do pai e transformá-lo em folha.
        </p>
      </>
    );
  }

  if (topic === "files") {
    return (
      <>
        <h3>Importar e exportar</h3>
        <p>O menu Arquivos organiza as ações em Importar e Exportar.</p>
        <ul>
          <li>Importar aceita JSON completo do estudo e CSV/TSV de matriz.</li>
          <li>Exportar JSON salva árvore, alternativas, pesos, escalas e valores de desempenho.</li>
          <li>Exportar CSV gera um arquivo com matriz de desempenho e tabela de desempenho MAVT.</li>
          <li>CSV/TSV importado deve ter Alternativa na primeira coluna e critérios folha nas demais.</li>
        </ul>
      </>
    );
  }

  if (topic === "results") {
    return (
      <>
        <h3>Resultados e sensibilidade</h3>
        <p>
          A pontuação total combina o valor normalizado de cada critério folha com seu peso global. A melhor alternativa
          é a que obtém a maior pontuação total.
        </p>
        <p>
          Os gráficos mostram pontuação, contribuição por critério e sensibilidade. Ao passar o mouse sobre um gráfico,
          os rótulos fixos somem para evitar duplicidade com a janela de valores.
        </p>
      </>
    );
  }

  return (
    <>
      <h3>Como usar o software</h3>
      <p>
        Comece pela Etapa 1A, editando o nome do problema e clicando nos nós da árvore para criar critérios e
        subcritérios. Depois use 1B para configurar os critérios: nomes de critérios compostos direto no nó e edição completa das folhas na janela.
      </p>
      <p>
        Na Etapa 2, use Alternativa e Matriz. Na Etapa 3, clique nos nós destacados para definir pesos. Na Etapa 4,
        use Resultados para abrir a análise MAVT.
      </p>
      <p>O menu Arquivos importa estudos ou exporta JSON completo e CSV consolidado.</p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
