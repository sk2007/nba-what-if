from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import torch
import torch.nn as nn


class MLPNet(nn.Module):
    def __init__(self, input_dim: int, hidden_layers: list[int], output_dim: int = 1):
        super().__init__()
        dims = [input_dim, *hidden_layers, output_dim]
        layers: list[nn.Module] = []
        for i in range(len(dims) - 1):
            layers.append(nn.Linear(dims[i], dims[i + 1]))
            if i < len(dims) - 2:
                layers.append(nn.ReLU())
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class ProbabilityWrapper(nn.Module):
    """Export probabilities while keeping backend-side numeric normalization."""

    def __init__(self, net: MLPNet):
        super().__init__()
        self.net = net

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.net(x))


def _load_net(checkpoint_path: Path) -> tuple[ProbabilityWrapper, np.ndarray, np.ndarray]:
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    n_numeric = int(checkpoint["n_numeric"])
    n_onehot = int(checkpoint["n_onehot"])
    hidden_layers = list(checkpoint["hidden_layers"])
    input_dim = n_numeric + n_onehot

    net = MLPNet(input_dim, hidden_layers)
    state_dict = checkpoint["state_dict"]
    net.load_state_dict({k: v for k, v in state_dict.items() if k.startswith("net.")})
    net.eval()

    num_mean = state_dict["num_mean"].detach().cpu().numpy().astype(np.float32)
    num_std = state_dict["num_std"].detach().cpu().numpy().astype(np.float32)
    return ProbabilityWrapper(net).eval(), num_mean, num_std


def convert(model_dir: Path, out_dir: Path) -> None:
    checkpoint_path = model_dir / "wp_model_mlp (1).pt"
    pipeline_path = model_dir / "wp_model_feature_pipeline (1).joblib"
    if not checkpoint_path.is_file():
        raise FileNotFoundError(checkpoint_path)
    if not pipeline_path.is_file():
        raise FileNotFoundError(pipeline_path)

    model, num_mean, num_std = _load_net(checkpoint_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Validate the feature pipeline before copying it into the runtime location.
    pipeline = joblib.load(pipeline_path)
    categories = pipeline.named_steps["preprocess"].named_transformers_["oh"].categories_[0]
    expected_categories = ["OT", "Q1", "Q2", "Q3", "Q4"]
    if list(categories) != expected_categories:
        raise ValueError(f"Unexpected quarter categories: {list(categories)}")

    dummy = torch.zeros((1, 20), dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        out_dir / "wp_model_mlp.onnx",
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=17,
    )
    np.savez(out_dir / "wp_model_stats.npz", num_mean=num_mean, num_std=num_std)
    joblib.dump(pipeline, out_dir / "wp_model_feature_pipeline.joblib")
    torch.save(torch.load(checkpoint_path, map_location="cpu", weights_only=False), out_dir / "wp_model_mlp.pt")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the new win-probability MLP to ONNX.")
    parser.add_argument("--model-dir", type=Path, default=Path("newModel"))
    parser.add_argument("--out-dir", type=Path, default=Path("."))
    args = parser.parse_args()
    convert(args.model_dir, args.out_dir)


if __name__ == "__main__":
    main()
