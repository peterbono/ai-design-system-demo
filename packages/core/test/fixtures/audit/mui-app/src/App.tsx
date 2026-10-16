import { Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import { Datagrid, List, TextField as RaTextField } from 'react-admin';

const Header = styled('header')(({ theme }) => ({
  padding: 16,
  color: theme.palette.text.primary,
  borderBottom: '1px solid #dce3eb',
}));

const styles = {
  card: { borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
};

export function App() {
  return (
    <Box sx={{ p: 2, bgcolor: 'background.paper', color: '#1c2735', marginTop: '13px' }}>
      <Header>Orders</Header>
      <Card style={styles.card}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Total</Typography>
          <TextField label="Name" />
          <Button variant="contained" startIcon={<DeleteIcon />}>Delete</Button>
          <button style={{ background: 'red', zIndex: 1200 }}>Raw</button>
        </CardContent>
      </Card>
      <List>
        <Datagrid>
          <RaTextField source="id" />
        </Datagrid>
      </List>
    </Box>
  );
}
