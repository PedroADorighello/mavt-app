import React, { useMemo, useState } from "react";
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
  ChevronLeft,
  ChevronRight,
  Plus,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

type ActiveModal = "alternatives" | "matrix" | "results" | null;

type CriterionNodeData = {
  criterion?: Criterion;
  selected: boolean;
  globalWeight: number;
  isLeaf: boolean;
  isRoot: boolean;
  label: string;
};

const ROOT_ID = "__overall__";
const colors = ["#78a6c8", "#f2a7a1", "#9bcf9f", "#e9c46a", "#b59bd8", "#7ac7c4"];

const initialModel: DecisionModel = {
  rootName: "Overall",
  alternatives: [
    { id: "alt-civic", name: "Civic" },
    { id: "alt-corolla", name: "Corolla" },
    { id: "alt-hb20", name: "HB20" },
  ],
  criteria: [
    {
      id: "crit-custo",
      name: "Custo",
      weight: 35,
      children: [
        {
          id: "crit-preco",
          name: "Preco",
          weight: 75,
          scale: { min: 80000, max: 150000, direction: "cost" },
          performances: { "alt-civic": 145000, "alt-corolla": 142000, "alt-hb20": 88000 },
        },
        {
          id: "crit-manutencao",
          name: "Manutencao",
          weight: 25,
          scale: { min: 2500, max: 9000, direction: "cost" },
          performances: { "alt-civic": 7400, "alt-corolla": 6900, "alt-hb20": 3900 },
        },
      ],
    },
    {
      id: "crit-qualidade",
      name: "Qualidade",
      weight: 40,
      children: [
        {
          id: "crit-seguranca",
          name: "Seguranca",
          weight: 55,
          scale: { min: 0, max: 10, direction: "benefit" },
          performances: { "alt-civic": 9.2, "alt-corolla": 9, "alt-hb20": 7.4 },
        },
        {
          id: "crit-conforto",
          name: "Conforto",
          weight: 45,
          scale: { min: 0, max: 10, direction: "benefit" },
          performances: { "alt-civic": 8.8, "alt-corolla": 8.5, "alt-hb20": 6.8 },
        },
      ],
    },
    {
      id: "crit-sustentabilidade",
      name: "Sustentabilidade",
      weight: 25,
      scale: { min: 0, max: 10, direction: "benefit" },
      performances: { "alt-civic": 7.8, "alt-corolla": 8.6, "alt-hb20": 7 },
    },
  ],
};

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const isLeaf = (criterion: Criterion) => !criterion.children || criterion.children.length === 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const sumWeights = (items: Criterion[]) => items.reduce((sum, item) => sum + Math.max(0, item.weight), 0) || 1;
const displayWeight = (value: number) => Math.round(value * 10) / 10;

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

function collectLeaves(criteria: Criterion[], multiplier = 1): Array<{ criterion: Criterion; weight: number }> {
  const total = sumWeights(criteria);
  return criteria.flatMap((criterion) => {
    const local = multiplier * (Math.max(0, criterion.weight) / total);
    if (isLeaf(criterion)) return [{ criterion, weight: local }];
    return collectLeaves(criterion.children ?? [], local);
  });
}

function valueFor(criterion: Criterion, rawValue: number | string | undefined): number {
  const scale = criterion.scale ?? { min: 0, max: 10, direction: "benefit" as Direction };
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
  const scale = criterion.scale ?? { min: 0, max: 10, direction: "benefit" as Direction };
  const values = Object.values(criterion.performances ?? {})
    .map((value) => Number(value))
    .filter(Number.isFinite);

  if (scale.autoBounds !== false && values.length >= 2) {
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  return { min: scale.min, max: scale.max };
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

function layoutCriteria(criteria: Criterion[], rootName: string, selectedId?: string) {
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
    },
    draggable: false,
  });

  return { nodes, edges };
}

function CriterionFlowNode({ data }: { data: CriterionNodeData }) {
  return (
    <div className={`criterion-node ${data.selected ? "selected" : ""} ${data.isLeaf ? "leaf" : "parent"}`}>
      {!data.isRoot && <Handle type="target" position={Position.Left} className="flow-handle" />}
      <strong>{data.label}</strong>
      {!data.isRoot && (
        <div className="node-meta">
          <span>{displayWeight(data.criterion?.weight ?? 100)}% local</span>
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
  size?: "medium" | "large" | "compact";
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
  const [past, setPast] = useState<DecisionModel[]>([]);
  const [future, setFuture] = useState<DecisionModel[]>([]);
  const [model, setModel] = useState(() => ({
    ...initialModel,
    criteria: normalizeSiblings(initialModel.criteria),
  }));
  const [selectedId, setSelectedId] = useState(ROOT_ID);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Posso editar a estrutura por voce. Tente: adicione alternativa SUV, adicione criterio seguranca peso 20%, ou remova HB20.",
    },
  ]);
  const [sensitivityLeafId, setSensitivityLeafId] = useState("crit-preco");

  const leaves = useMemo(() => collectLeaves(model.criteria), [model.criteria]);
  const results = useMemo(() => calculateResults(model), [model]);
  const flow = useMemo(() => layoutCriteria(model.criteria, model.rootName, selectedId), [
    model.criteria,
    model.rootName,
    selectedId,
  ]);
  const selectedCriterion = selectedId === ROOT_ID ? undefined : findCriterion(model.criteria, selectedId);
  const selectedChildren = selectedId === ROOT_ID ? model.criteria : selectedCriterion?.children ?? [];
  const selectedParent = selectedId === ROOT_ID ? undefined : findParent(model.criteria, selectedId);
  const canDeleteSelected =
    selectedId !== ROOT_ID &&
    (selectedParent ? (selectedParent.children?.length ?? 0) > 2 : model.criteria.length > 2);

  const commit = (updater: (current: DecisionModel) => DecisionModel) => {
    setModel((current) => {
      const next = updater(current);
      setPast((items) => [...items, current].slice(-40));
      setFuture([]);
      return next;
    });
  };

  const undo = () => {
    setPast((items) => {
      const previous = items[items.length - 1];
      if (!previous) return items;
      setFuture((next) => [model, ...next]);
      setModel(previous);
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((previous) => [...previous, model]);
      setModel(next);
      return items.slice(1);
    });
  };

  const openResults = () => {
    setNotice("");
    setInspectorOpen(false);
    setActiveModal("results");
  };

  const addRootCriterion = () => {
    const criterion: Criterion = {
      id: uid("crit"),
      name: "Novo criterio",
      weight: 20,
      scale: { min: 0, max: 10, direction: "benefit" },
      performances: {},
    };
    commit((current) => ({ ...current, criteria: addWeightedSibling(current.criteria, criterion, 20) }));
    setSelectedId(criterion.id);
    setInspectorOpen(true);
  };

  const resetDecision = () => {
    const confirmed = window.confirm(
      "Reiniciar apagará todas as alternativas e substituirá a árvore atual por um nó raiz com duas folhas. Deseja continuar?",
    );
    if (!confirmed) return;

    const first: Criterion = {
      id: uid("crit"),
      name: "Criterio 1",
      weight: 50,
      scale: { min: 0, max: 10, direction: "benefit", mode: "quantitative" },
      performances: {},
    };
    const second: Criterion = {
      id: uid("crit"),
      name: "Criterio 2",
      weight: 50,
      scale: { min: 0, max: 10, direction: "benefit", mode: "quantitative" },
      performances: {},
    };

    commit((current) => ({
      ...current,
      alternatives: [],
      criteria: [first, second],
    }));
    setSelectedId(ROOT_ID);
    setInspectorOpen(false);
    setActiveModal(null);
  };

  const addChildCriterion = (parentId: string) => {
    const child: Criterion = {
      id: uid("crit"),
      name: "Subcriterio",
      weight: 20,
      scale: { min: 0, max: 10, direction: "benefit" },
      performances: {},
    };
    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, parentId, (criterion) => {
        const children = criterion.children ?? [];
        if (children.length === 0) {
          const first: Criterion = {
            id: uid("crit"),
            name: "Subcriterio A",
            weight: 50,
            scale: criterion.scale ?? { min: 0, max: 10, direction: "benefit" },
            performances: { ...(criterion.performances ?? {}) },
          };
          const second: Criterion = {
            id: uid("crit"),
            name: "Subcriterio B",
            weight: 50,
            scale: criterion.scale ?? { min: 0, max: 10, direction: "benefit" },
            performances: { ...(criterion.performances ?? {}) },
          };
          return { ...criterion, children: [first, second], scale: undefined, performances: undefined };
        }
        return { ...criterion, children: addWeightedSibling(children, child, 20) };
      }),
    }));
  };

  const updateSelected = (updater: (criterion: Criterion) => Criterion) => {
    if (selectedId === ROOT_ID) return;
    commit((current) => ({ ...current, criteria: updateCriterion(current.criteria, selectedId, updater) }));
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
      setNotice("Nao e possivel remover este no porque o pai ficaria com apenas um filho.");
      return;
    }
    commit((current) => ({ ...current, criteria: normalizeTreeAfterRemoval(removeCriterion(current.criteria, selectedId)) }));
    setSelectedId(ROOT_ID);
    setInspectorOpen(false);
  };

  const addAlternative = (name = "Nova alternativa") => {
    const alternative = { id: uid("alt"), name };
    commit((current) => ({ ...current, alternatives: [...current.alternatives, alternative] }));
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
  };

  const setPerformance = (criterionId: string, alternativeId: string, value: number | string) => {
    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, criterionId, (criterion) => ({
        ...criterion,
        performances: { ...(criterion.performances ?? {}), [alternativeId]: value },
      })),
    }));
  };

  const convertSelectedToLeaf = () => {
    if (selectedId === ROOT_ID || !selectedCriterion || isLeaf(selectedCriterion)) return;
    const confirmed = window.confirm(
      `Transformar "${selectedCriterion.name}" em folha de curva de valor apagará todos os seus subcriterios. Deseja continuar?`,
    );
    if (!confirmed) return;

    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, selectedId, (criterion) => ({
        ...criterion,
        children: undefined,
        scale: { min: 0, max: 10, direction: "benefit", mode: "quantitative" },
        performances: {},
      })),
    }));
  };

  const runAssistantCommand = () => {
    const text = chatInput.trim();
    if (!text) return;
    setMessages((items) => [...items, { role: "user", text }]);
    setChatInput("");
    const response = interpretCommand(text, model, commit, setSelectedId, setNotice);
    setMessages((items) => [...items, { role: "assistant", text: response }]);
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
              <p>Decisao multicriterio em uma area de trabalho limpa</p>
            </div>
          </div>

          <div className="toolbar">
            <button className="primary" onClick={openResults}>
              <BarChart3 size={16} />
              Resultados
            </button>
            <button onClick={() => setActiveModal("alternatives")}>
              <Plus size={16} />
              Alternativa
            </button>
            <button onClick={() => setActiveModal("matrix")}>
              <Table2 size={16} />
              Matriz
            </button>
            <button className="danger" onClick={resetDecision}>
              <RotateCcw size={16} />
              Reiniciar
            </button>
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

        <main className={`workspace ${chatOpen ? "with-chat" : ""}`}>
          <section className="tree-workspace">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Arvore de decisao</span>
                <h2>{model.rootName}</h2>
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

          {!chatOpen && (
            <button className="chat-restore" onClick={() => setChatOpen(true)} aria-label="Abrir chat da IA">
              <ChevronLeft size={18} />
              IA
            </button>
          )}

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
            <div className="chat-box">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && runAssistantCommand()}
                placeholder="Ex: peso do preco para 35%"
              />
              <button onClick={runAssistantCommand} aria-label="Enviar comando">
                <Sparkles size={18} />
              </button>
            </div>
          </aside>
        </main>

        {activeModal === "results" && (
          <Modal title="Resultados da decisao" size="large" onClose={() => setActiveModal(null)}>
            <div className="results-window">
              <ResultsPanel
                results={results}
                leaves={leaves}
                sensitivityData={sensitivityData}
                sensitivityLeafId={sensitivityLeafId}
                onSensitivityChange={setSensitivityLeafId}
                alternatives={model.alternatives}
              />
            </div>
          </Modal>
        )}

        {inspectorOpen && (
          <Modal
            title={selectedId === ROOT_ID ? "Editar pesos principais" : `Editar ${selectedCriterion?.name ?? "criterio"}`}
            size="compact"
            onClose={() => setInspectorOpen(false)}
          >
            <CriterionInspector
              selectedId={selectedId}
              criterion={selectedCriterion}
              children={selectedChildren}
              alternatives={model.alternatives}
              canDelete={canDeleteSelected}
              notice={notice}
              rootName={model.rootName}
              onChange={updateSelected}
              onRootNameChange={(rootName) => commit((current) => ({ ...current, rootName }))}
              onSiblingWeightChange={updateSiblingWeight}
              onDelete={deleteSelected}
              onAddChild={() => {
                if (selectedId !== ROOT_ID && selectedCriterion && isLeaf(selectedCriterion)) {
                  const confirmed = window.confirm("Ao adicionar subcriterios, esta folha deixa de ser curva de valor.");
                  if (!confirmed) return;
                }
                selectedId === ROOT_ID ? addRootCriterion() : addChildCriterion(selectedId);
              }}
              onConvertToLeaf={convertSelectedToLeaf}
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
            onPerformanceChange={setPerformance}
          />
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

function interpretCommand(
  rawText: string,
  model: DecisionModel,
  commit: (updater: (current: DecisionModel) => DecisionModel) => void,
  setSelectedId: (id: string) => void,
  setNotice: (text: string) => void,
) {
  const text = rawText.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const numberMatch = text.match(/(\d+(?:[,.]\d+)?)\s*%?/);
  const parsedWeight = numberMatch ? Number(numberMatch[1].replace(",", ".")) : 20;

  const addAlternativeMatch = text.match(/(?:adicione|inclua|crie)\s+(?:a\s+)?alternativa\s+(.+)/);
  if (addAlternativeMatch) {
    const name = titleCase(addAlternativeMatch[1].replace(/\s+com\s+.*/, "").trim());
    const alternative = { id: uid("alt"), name };
    commit((current) => ({ ...current, alternatives: [...current.alternatives, alternative] }));
    return `Adicionei a alternativa ${name}.`;
  }

  const removeAlternativeMatch = text.match(/(?:remova|apague|exclua)\s+(?:a\s+)?(?:alternativa\s+)?(.+)/);
  if (removeAlternativeMatch) {
    const name = removeAlternativeMatch[1].trim();
    const alternative = model.alternatives.find((item) => item.name.toLowerCase() === name);
    if (!alternative) return "Nao encontrei essa alternativa. Confira o nome e tente novamente.";
    commit((current) => ({
      ...current,
      alternatives: current.alternatives.filter((item) => item.id !== alternative.id),
      criteria: updateAllLeaves(current.criteria, (criterion) => {
        const performances = { ...(criterion.performances ?? {}) };
        delete performances[alternative.id];
        return { ...criterion, performances };
      }),
    }));
    return `Removi ${alternative.name} da avaliacao.`;
  }

  const addCriterionMatch = text.match(/(?:adicione|inclua|crie)\s+(?:o\s+)?criterio\s+(.+?)(?:\s+com|\s+peso|$)/);
  if (addCriterionMatch) {
    const name = titleCase(addCriterionMatch[1].trim());
    const criterion: Criterion = {
      id: uid("crit"),
      name,
      weight: parsedWeight,
      scale: { min: 0, max: 10, direction: "benefit" },
      performances: {},
    };
    commit((current) => ({ ...current, criteria: addWeightedSibling(current.criteria, criterion, parsedWeight) }));
    setSelectedId(criterion.id);
    return `Criei o criterio raiz ${name}. Os demais pesos foram ajustados para manter soma 100%.`;
  }

  const removeCriterionMatch = text.match(/(?:remova|apague|exclua)\s+(?:o\s+)?criterio\s+(.+)/);
  if (removeCriterionMatch) {
    const name = removeCriterionMatch[1].trim();
    const criterion = flattenCriteria(model.criteria).find((item) => item.name.toLowerCase() === name);
    if (!criterion) return "Nao encontrei esse criterio. Tente usar exatamente o nome exibido no no.";
    const parent = findParent(model.criteria, criterion.id);
    const canRemove = parent ? (parent.children?.length ?? 0) > 2 : model.criteria.length > 2;
    if (!canRemove) {
      setNotice("Remocao bloqueada: o pai ficaria com apenas um filho.");
      return "Nao removi esse criterio porque um no nao pode ficar com apenas um filho.";
    }
    commit((current) => ({ ...current, criteria: normalizeTreeAfterRemoval(removeCriterion(current.criteria, criterion.id)) }));
    return `Removi o criterio ${criterion.name} e normalizei os pesos restantes.`;
  }

  const weightMatch = text.match(/peso\s+(?:do|da|de)?\s*(.+?)\s+(?:para\s+)?(\d+(?:[,.]\d+)?)\s*%?/);
  if (weightMatch) {
    const name = weightMatch[1].trim();
    const weight = Number(weightMatch[2].replace(",", "."));
    const criterion = flattenCriteria(model.criteria).find((item) => item.name.toLowerCase() === name);
    if (!criterion) return "Nao encontrei esse criterio para alterar o peso.";
    const parent = findParent(model.criteria, criterion.id);
    commit((current) => {
      if (!parent) return { ...current, criteria: normalizeSiblings(current.criteria, criterion.id, weight) };
      return {
        ...current,
        criteria: updateCriterion(current.criteria, parent.id, (item) => ({
          ...item,
          children: normalizeSiblings(item.children ?? [], criterion.id, weight),
        })),
      };
    });
    setSelectedId(parent?.id ?? ROOT_ID);
    return `Atualizei ${criterion.name} para ${weight}% e redistribui os irmaos para soma 100%.`;
  }

  const scaleMatch = text.match(
    /(?:defina|configure).*(.+?)\s+de\s+(\d+(?:[,.]\d+)?)\s+a\s+(\d+(?:[,.]\d+)?)(.*)/,
  );
  if (scaleMatch) {
    const name = scaleMatch[1].replace(/criterio|curva|funcao|valor|o|a/g, "").trim();
    const criterion = flattenCriteria(model.criteria).find((item) => item.name.toLowerCase().includes(name));
    if (!criterion || !isLeaf(criterion)) return "Nao encontrei uma folha compativel para configurar a curva.";
    const min = Number(scaleMatch[2].replace(",", "."));
    const max = Number(scaleMatch[3].replace(",", "."));
    const tail = scaleMatch[4];
    const direction: Direction = tail.includes("menor") || tail.includes("custo") ? "cost" : "benefit";
    commit((current) => ({
      ...current,
      criteria: updateCriterion(current.criteria, criterion.id, (item) => ({ ...item, scale: { min, max, direction } })),
    }));
    setSelectedId(criterion.id);
    return `Configurei a curva de ${criterion.name}: ${min} a ${max}, ${direction === "cost" ? "menor e melhor" : "maior e melhor"}.`;
  }

  return "Ainda sou um agente simulado. Entendi melhor comandos para adicionar/remover alternativas, criar criterios, alterar pesos e configurar curvas.";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function CriterionInspector({
  selectedId,
  criterion,
  children,
  alternatives,
  canDelete,
  notice,
  rootName,
  onChange,
  onRootNameChange,
  onSiblingWeightChange,
  onDelete,
  onAddChild,
  onConvertToLeaf,
  onPerformanceChange,
}: {
  selectedId: string;
  criterion?: Criterion;
  children: Criterion[];
  alternatives: Alternative[];
  canDelete: boolean;
  notice: string;
  rootName: string;
  onChange: (updater: (criterion: Criterion) => Criterion) => void;
  onRootNameChange: (rootName: string) => void;
  onSiblingWeightChange: (childId: string, weight: number) => void;
  onDelete: () => void;
  onAddChild: () => void;
  onConvertToLeaf: () => void;
  onPerformanceChange: (alternativeId: string, value: number | string) => void;
}) {
  const isRoot = selectedId === ROOT_ID;
  const leaf = criterion ? isLeaf(criterion) : false;
  const scale = criterion?.scale ?? { min: 0, max: 10, direction: "benefit" as Direction };
  const scaleMode = scale.mode ?? "quantitative";
  const quantitativeBounds = criterion ? getQuantitativeBounds(criterion) : { min: scale.min, max: scale.max };
  const valuePoints = scale.valuePoints ?? [];
  const qualitativeOptions = scale.qualitativeOptions ?? [
    { id: "qual-ruim", label: "Ruim", score: 0 },
    { id: "qual-medio", label: "Medio", score: 50 },
    { id: "qual-bom", label: "Bom", score: 100 },
  ];

  return (
    <div className="inspector-content">
      {notice && <div className="notice">{notice}</div>}

      {isRoot && (
        <label className="field">
          Nome
          <input value={rootName} onChange={(event) => onRootNameChange(event.target.value)} />
        </label>
      )}

      {!isRoot && criterion && (
        <label className="field">
          Nome
          <input value={criterion.name} onChange={(event) => onChange((item) => ({ ...item, name: event.target.value }))} />
        </label>
      )}

      {!leaf && (
        <div className="weight-editor">
          <div className="section-title">Pesos dos filhos</div>
          <p className="helper-text">Ajuste um peso e os irmaos serao redistribuidos automaticamente.</p>

          {children.map((child) => (
            <div className="weight-row" key={child.id}>
              <div>
                <strong>{child.name}</strong>
                <span>{isLeaf(child) ? "Folha de valor" : "Criterio composto"}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={child.weight}
                onChange={(event) => onSiblingWeightChange(child.id, Number(event.target.value))}
              />
              <input
                type="number"
                min="0"
                max="100"
                value={displayWeight(child.weight)}
                onChange={(event) => onSiblingWeightChange(child.id, Number(event.target.value))}
              />
            </div>
          ))}

          <div className="button-row">
            <button onClick={onAddChild}>
              <Plus size={16} />
              Subcriterio
            </button>
            {!isRoot && (
              <button className="danger" onClick={onConvertToLeaf}>
                <Trash2 size={16} />
                Transformar em folha
              </button>
            )}
          </div>
        </div>
      )}

      {leaf && criterion && (
        <div className="leaf-editor">
          <div className="readonly-weight">
            Peso local: <strong>{displayWeight(criterion.weight)}%</strong>
          </div>
          <div className="section-title">Funcao de valor</div>
          <label className="field">
            Tipo de metrica
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
                  checked={scale.autoBounds !== false}
                  onChange={(event) =>
                    onChange((item) => ({
                      ...item,
                      scale: { ...scale, mode: "quantitative", autoBounds: event.target.checked },
                    }))
                  }
                />
                Ajustar minimo e maximo automaticamente pelos valores das alternativas
              </label>
              <div className="field-grid">
                <label className="field">
                  Minimo
                  <input
                    type="number"
                    value={scale.min}
                    disabled={scale.autoBounds !== false}
                    onChange={(event) =>
                      onChange((item) => ({
                        ...item,
                        scale: { ...scale, mode: "quantitative", autoBounds: false, min: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  Maximo
                  <input
                    type="number"
                    value={scale.max}
                    disabled={scale.autoBounds !== false}
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
                Direcao
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
                  <p className="helper-text">O score sera interpolado entre os pontos definidos.</p>
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
              <div className="section-title">Opcoes qualitativas</div>
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
                    aria-label="Remover opcao"
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
                        { id: uid("qual"), label: "Nova opcao", score: 50 },
                      ],
                    },
                  }))
                }
              >
                <Plus size={16} />
                Opcao qualitativa
              </button>
            </div>
          )}

          <div className="section-title">Valores das alternativas</div>
          <div className="performance-list">
            {alternatives.map((alternative) => (
              <label className="field inline" key={alternative.id}>
                <span>{alternative.name}</span>
                {scaleMode === "qualitative" ? (
                  <select
                    value={String(criterion.performances?.[alternative.id] ?? "")}
                    onChange={(event) => onPerformanceChange(alternative.id, event.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {qualitativeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    value={criterion.performances?.[alternative.id] ?? ""}
                    onChange={(event) => onPerformanceChange(alternative.id, Number(event.target.value))}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {!isRoot && (
        <div className="inspector-actions">
          {leaf && (
            <button onClick={onAddChild}>
              <Plus size={16} />
              Adicionar subcriterios
            </button>
          )}
          <button className="danger" onClick={onDelete} disabled={!canDelete}>
            <Trash2 size={16} />
            Remover no
          </button>
        </div>
      )}
    </div>
  );
}

function ResultsPanel({
  results,
  leaves,
  sensitivityData,
  sensitivityLeafId,
  onSensitivityChange,
  alternatives,
}: {
  results: ReturnType<typeof calculateResults>;
  leaves: Array<{ criterion: Criterion; weight: number }>;
  sensitivityData: Array<Record<string, string | number>>;
  sensitivityLeafId: string;
  onSensitivityChange: (id: string) => void;
  alternatives: Alternative[];
}) {
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
          <h2>Analise MAVT</h2>
        </div>
        <BarChart3 size={22} />
      </div>

      <div className="winner-strip">
        <span>Melhor alternativa</span>
        <strong>{results[0]?.name ?? "Sem dados"}</strong>
        <b>{Math.round(results[0]?.score ?? 0)} pts</b>
      </div>

      <div className="chart-card">
        <h3>Pontuacao ponderada</h3>
        <ResponsiveContainer width="100%" height={205}>
          <BarChart data={results}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="score" radius={[8, 8, 0, 0]}>
              {results.map((entry, index) => (
                <Cell key={entry.id} fill={colors[index % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Contribuicao por criterio</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={stackedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            {leaves.map((leaf, index) => (
              <Bar key={leaf.criterion.id} dataKey={leaf.criterion.name} stackId="a" fill={colors[index % colors.length]} />
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
                  <td>{result.score.toFixed(1)}</td>
                  {leaves.map((leaf) => {
                    const contribution = result.contributions.find((item) => item.id === leaf.criterion.id);
                    return <td key={leaf.criterion.id}>{(contribution?.value ?? 0).toFixed(1)}</td>;
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
          <LineChart data={sensitivityData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="ajuste" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Legend />
            {alternatives.map((alternative, index) => (
              <Line
                key={alternative.id}
                dataKey={alternative.name}
                stroke={colors[index % colors.length]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
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
  onRemove,
  onRename,
}: {
  alternatives: Alternative[];
  onClose: () => void;
  onAdd: () => void;
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
    </Modal>
  );
}

function MatrixModal({
  alternatives,
  leaves,
  onClose,
  onPerformanceChange,
}: {
  alternatives: Alternative[];
  leaves: Array<{ criterion: Criterion; weight: number }>;
  onClose: () => void;
  onPerformanceChange: (criterionId: string, alternativeId: string, value: number | string) => void;
}) {
  return (
    <Modal title="Matriz de desempenho" size="large" onClose={onClose}>
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
                        onChange={(event) => onPerformanceChange(leaf.criterion.id, alternative.id, Number(event.target.value))}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
