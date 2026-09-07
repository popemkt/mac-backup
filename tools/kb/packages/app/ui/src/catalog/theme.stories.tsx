import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeStudy } from "@/components/prefs/theme-study";

const meta = {
  title: "Workspace/Theme",
  component: ThemeStudy,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ThemeStudy>;

export default meta;
type Story = StoryObj<typeof meta>;
export const DayAndNight: Story = {};
