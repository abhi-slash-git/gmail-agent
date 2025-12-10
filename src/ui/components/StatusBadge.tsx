import { Text } from "ink";

interface StatusBadgeProps {
	status: "success" | "error" | "warning" | "info";
	children: React.ReactNode;
}

const colors = {
	error: "red",
	info: "blue",
	success: "green",
	warning: "yellow"
} as const;

export function StatusBadge({ status, children }: StatusBadgeProps) {
	return <Text color={colors[status]}>{children}</Text>;
}
